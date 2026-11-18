// Unit test for ts/api/agent_runtime.js against a stub scene. Run: node tests/agent-runtime.test.mjs
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../ts/api/agent_runtime.js', import.meta.url), 'utf8');
let passed = 0;
const J = (x) => JSON.stringify(x);
const check = async (name, fn) => { await fn(); passed += 1; console.log('PASS', name); };

function makeContext({ broken = false } = {}) {
  const listeners = [];
  const sandbox = { console, performance, setTimeout, clearTimeout, Promise, Error, Set, Map, WeakSet, ArrayBuffer, Object, Array, JSON, Number, String, Math };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  sandbox.location = { origin: 'http://host' };
  sandbox.parent = {};
  sandbox.__renders = 0;
  sandbox.render = () => { sandbox.__renders += 1; };
  const ctx = vm.createContext(sandbox);
  // classic-script lexical globals, exactly like the viewer's main.ts
  vm.runInContext(`
    class Nuc { constructor(id, strand, rna) { this.id = id; this.strand = strand; this.n3 = null; this.n5 = null; this._rna = rna; }
      isRNA() { return this._rna; } getPos() { return { x: 1, y: 2, z: 3 }; } }
    class Strand { constructor(id) { this.id = id; this.list = []; this.system = null; }
      forEach(fn) { this.list.forEach(fn); } getLength() { return this.list.length; } }
    const elements = new Map();
    const systems = [];
    const selectedBases = new Set();
    function makeSystem(n, rna) {
      const strand = new Strand(1); const sys = { id: 0, strands: [strand] }; strand.system = sys;
      for (let i = 0; i < n; i++) { const e = new Nuc(i, strand, rna); strand.list.push(e); elements.set(i, e); }
      for (let i = 1; i < n; i++) { strand.list[i].n5 = strand.list[i - 1]; strand.list[i - 1].n3 = strand.list[i]; }
      systems.push(sys); return sys;
    }
    makeSystem(12, true);
  `, ctx);
  if (broken) vm.runInContext('elements.get(3).n3 = elements.get(7);', ctx);
  vm.runInContext(source, ctx);
  return { ctx, listeners, win: sandbox };
}

const { win } = makeContext();
const rt = win.oxAgentRuntime;

await check('inspect reports the live scene', () => {
  const s = rt.inspect();
  assert.equal(s.nucleotideCount, 12); assert.equal(s.nucleotides, 12); assert.equal(s.strandCount, 1); assert.equal(s.systemCount, 1);
  assert.equal(s.systems[0].rna, 12); assert.equal(s.hasScene, true);
});

await check('validate accepts a consistent chain and flags an asymmetric link', () => {
  assert.equal(rt.validate().ok, true);
  const broken = makeContext({ broken: true }).win.oxAgentRuntime.validate();
  assert.equal(broken.ok, false); assert.equal(broken.errors[0].code, 'AsymmetricLink');
});

await check('execute returns the value, console output and the scene delta', async () => {
  const r = await rt.execute("console.log('hi'); await Promise.resolve(); return { n: elements.size };");
  assert.equal(r.ok, true); assert.equal(J(r.value), J({ n: 12 })); assert.equal(r.logs[0].text, 'hi');
  assert.equal(J(r.scene.before), J(r.scene.after)); assert.ok(win.__renders >= 1);
});

await check('execute reports a runtime error with name, line, source and a hint', async () => {
  const r = await rt.execute('const a = 1;\nundefinedFunction(a);');
  assert.equal(r.ok, false); assert.equal(r.error.name, 'ReferenceError');
  assert.match(r.error.message, /undefinedFunction/); assert.equal(r.error.line, 2); assert.match(r.error.source, /undefinedFunction/);
  assert.match(r.error.hint, /globals|capabilities/); assert.equal(r.diagnostics[0].code, 'ReferenceError');
  assert.match(rt.describeRun(r), /^ERROR: ReferenceError/);
});

await check('execute reports syntax errors, empty code, oversize code and timeouts without throwing', async () => {
  const syn = await rt.execute('const = ;');
  assert.equal(syn.ok, false); assert.equal(syn.error.name, 'SyntaxError'); assert.equal(syn.executed, false);
  assert.equal((await rt.execute('  ')).error.name, 'NoCode');
  assert.equal((await rt.execute('x'.repeat(40000))).error.name, 'CodeTooLong');
  const slow = await rt.execute('await new Promise(r => setTimeout(r, 2000));', { timeoutMs: 150 });
  assert.equal(slow.ok, false); assert.equal(slow.error.name, 'ViewerTimeout'); assert.match(slow.error.hint, /smaller steps/);
});

await check('execute warns when code leaves the topology inconsistent', async () => {
  const w = makeContext().win;
  const r = await w.oxAgentRuntime.execute('elements.get(2).n3 = elements.get(9);');
  assert.equal(r.ok, true); assert.equal(r.warnings[0].code, 'TopologyWarning');
});

await check('execute never materialises a huge returned array or set', async () => {
  const t0 = Date.now();
  const r = await rt.execute('return { big: new Float32Array(2e7), s: new Set([1,2,3]) };');
  assert.equal(r.ok, true); assert.equal(r.value.big.length, 101); assert.match(String(r.value.big[100]), /more/); assert.equal(r.value.s.size, 3);
  assert.ok(Date.now() - t0 < 3000);
});

await check('requests are serialised: a slow edit finishes before the next starts', async () => {
  const order = [];
  const a = rt.execute("await new Promise(r => setTimeout(r, 60)); return 'a';").then((r) => order.push(r.value));
  const b = rt.execute("return 'b';").then((r) => order.push(r.value));
  await Promise.all([a, b]); assert.equal(J(order), J(['a', 'b']));
});

await check('task refuses cleanly without an LLM agent or key', async () => {
  const r = await rt.task('delete everything');
  assert.equal(r.ok, false); assert.equal(r.diagnostics[0].code, 'ViewerLLMUnavailable');
  const c = makeContext();
  vm.runInContext("const AGENT_CONFIG = { apiKey: '', model: 'm' };", c.ctx);
  Object.assign(c.win, { agentPlanner: async () => ['one step'], agentExecutor: async () => 'return 1;', agentObserver: async () => ({ success: true, feedback: '' }), agentSummarizer: async () => 'done' });
  const noKey = await c.win.oxAgentRuntime.task('x');
  assert.equal(noKey.ok, false); assert.equal(noKey.diagnostics[0].code, 'ViewerLLMNotConfigured');
});

await check('task runs plan -> code -> structured run -> observer and retries with the error text', async () => {
  const c = makeContext();
  vm.runInContext("const AGENT_CONFIG = { apiKey: 'k', model: 'm' };", c.ctx);
  const seen = [];
  Object.assign(c.win, {
    agentPlanner: async () => ['do it'],
    agentExecutor: async (step, retry) => { seen.push(retry); return retry ? 'return 7;' : 'missing();'; },
    agentObserver: async (step, code, result) => ({ success: result.startsWith('SUCCESS'), feedback: 'observer says ' + result.split('\n')[0] }),
    agentSummarizer: async () => 'all good',
  });
  const r = await c.win.oxAgentRuntime.task('do it');
  assert.equal(r.ok, true); assert.equal(r.steps[0].attempts.length, 2); assert.equal(r.steps[0].attempts[0].run.error.name, 'ReferenceError');
  assert.match(seen[1], /ERROR: ReferenceError/); assert.equal(r.summary, 'all good'); assert.equal(r.scene.nucleotideCount, 12);
});

await check('two concurrent tasks and an execute are serialised: their steps never interleave', async () => {
  const c = makeContext();
  vm.runInContext("const AGENT_CONFIG = { apiKey: 'k', model: 'm' };", c.ctx);
  const order = [];
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  Object.assign(c.win, {
    agentPlanner: async (t) => { order.push('plan ' + t); await delay(30); return ['s1', 's2']; },
    agentExecutor: async (step) => { order.push('exec ' + step); await delay(10); return 'return 1;'; },
    agentObserver: async () => ({ success: true, feedback: 'ok' }),
    agentSummarizer: async (t) => { order.push('done ' + t); return 'ok'; },
  });
  const rt = c.win.oxAgentRuntime;
  const [a, b, e] = await Promise.all([rt.task('A'), rt.task('B'), rt.execute('return 1;')]);
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(e.ok, true);
  // all of A (plan, both execs, done) happens before anything of B
  assert.deepEqual(order, ['plan A', 'exec s1', 'exec s2', 'done A', 'plan B', 'exec s1', 'exec s2', 'done B']);
});

await check('a model call that never answers times out instead of holding the queue', async () => {
  const c = makeContext();
  vm.runInContext("const AGENT_CONFIG = { apiKey: 'k', model: 'm' };", c.ctx);
  Object.assign(c.win, { agentPlanner: () => new Promise(() => {}), agentExecutor: async () => 'return 1;', agentObserver: async () => ({ success: true }), agentSummarizer: async () => '' });
  const rt = c.win.oxAgentRuntime;
  const t0 = Date.now();
  const r = await rt.task('hang', { llmTimeoutMs: 1000 });
  assert.equal(r.ok, false); assert.equal(r.diagnostics[0].code, 'ViewerPlanFailed'); assert.match(r.error, /timed out after 1000 ms/);
  assert.ok(Date.now() - t0 < 4000);
  const after = await rt.execute('return 2;');           // the queue is free again
  assert.equal(after.ok, true); assert.equal(after.value, 2);
});

function request(c, data, { source, origin = 'http://host', port = true } = {}) {
  return new Promise((resolve) => {
    const replies = [];
    const portObj = { postMessage: (m) => { replies.push(m); resolve(m); } };
    for (const l of c.listeners) l({ data, origin, source: source ?? c.win.parent, ports: port ? [portObj] : [] });
    setTimeout(() => resolve(replies[0] ?? null), 300);
  });
}

await check('host protocol answers trusted requests and rejects untrusted senders and unknown methods', async () => {
  const c = makeContext();
  const ok = await request(c, { type: 'oxview_api_request', id: 'a', method: 'inspect', args: [] });
  assert.equal(ok.ok, true); assert.equal(ok.id, 'a'); assert.equal(ok.result.nucleotideCount, 12);
  const ran = await request(c, { type: 'oxview_api_request', id: 'b', method: 'execute', args: ['return 5;'] });
  assert.equal(ran.ok, true); assert.equal(ran.result.ok, true); assert.equal(ran.result.value, 5);
  const bad = await request(c, { type: 'oxview_api_request', id: 'c', method: 'toString', args: [] });
  assert.equal(bad.ok, false); assert.equal(bad.diagnostics[0].code, 'UnknownMethod');
  const stranger = await request(c, { type: 'oxview_api_request', id: 'd', method: 'execute', args: ['return 1;'] }, { source: {} });
  assert.equal(stranger.ok, false); assert.equal(stranger.diagnostics[0].code, 'UntrustedSender');
  const wrongOrigin = await request(c, { type: 'oxview_api_request', id: 'e', method: 'inspect' }, { origin: 'http://evil' });
  assert.equal(wrongOrigin.diagnostics[0].code, 'UntrustedSender');
  assert.equal(await request(c, { type: 'oxview_api_request', id: 'f', method: 'inspect' }, { port: false }), null);
  assert.equal(await request(c, { type: 'something-else', method: 'inspect' }), null);
});

console.log(`\n${passed} passed`);
