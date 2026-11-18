/**
 * oxAgentRuntime: structured, awaited task API for agents that drive the viewer (the built-in Agent AI panel and an
 * embedding host such as NanoCanvas).
 *
 * Contract (everything returned is JSON-safe):
 *   capabilities() -> what exists in this viewer build (methods, globals, API namespaces, limits, whether an LLM key is set)
 *   inspect()      -> the live scene: nucleotide / strand / system counts, selection, per-system breakdown
 *   validate()     -> topology checks (reciprocal n3/n5 links, finite positions, element count); never throws
 *   execute(code)  -> run viewer JavaScript (async allowed) and report ok / value / logs / scene delta / structured error
 *   task(text)     -> headless planner -> executor -> observer loop using the viewer LLM; returns every generated code
 *                     block, its structured result and the observer's verdict for each attempt
 *
 * Host protocol (window.postMessage with a transferred MessagePort; only the embedding parent frame or this window,
 * same origin, is served):
 *   request  { type: 'oxview_api_request', id, method, args }   port: event.ports[0]
 *   response { id, ok: true, result }  |  { id, ok: false, error, diagnostics: [{ code, message, hint }] }
 * "ok: true" means the request was handled; a task failure is reported inside result ({ ok: false, error, ... }).
 *
 * Transparency: an execution error carries name, message, line, column, the offending source line and a repair hint, so
 * an agent can correct the exact statement instead of guessing.
 */
(function () {
    'use strict';

    const VERSION = 1;
    const METHODS = ['capabilities', 'inspect', 'validate', 'execute', 'task'];
    const LIMITS = { maxCodeChars: 30000, maxLogs: 100, maxText: 2000, maxList: 100, maxValidationErrors: 25, maxDepth: 8, maxNodes: 5000, defaultTimeoutMs: 60000, defaultLlmTimeoutMs: 120000, maxTimeoutMs: 600000 };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

    // Top-level `const`/`let` of classic scripts (elements, systems, selectedBases, AGENT_CONFIG) are global lexical
    // bindings, not window properties, so they are read through an indirect eval in the global scope.
    const readGlobal = (name) => {
        try { return (0, eval)(`typeof ${name} !== 'undefined' ? ${name} : undefined`); } catch (_) { return undefined; }
    };
    const clip = (text, n = LIMITS.maxText) => { const s = String(text); return s.length > n ? s.slice(0, n) + `... [${s.length - n} more chars]` : s; };

    /** Convert any value to something structured-cloneable: depth/size capped, cycles cut, scene objects summarised. */
    function plain(value, depth = 0, seen = new WeakSet(), ctx = { n: 0 }) {
        if (++ctx.n > LIMITS.maxNodes) return '[truncated]';
        if (value === null || value === undefined) return value ?? null;
        const t = typeof value;
        if (t === 'number') return Number.isFinite(value) ? value : String(value);
        if (t === 'boolean') return value;
        if (t === 'string') return clip(value);
        if (t === 'bigint') return String(value);
        if (t === 'function') return `[function ${value.name || 'anonymous'}]`;
        if (t === 'symbol') return String(value);
        if (seen.has(value)) return '[circular]';
        if (depth >= LIMITS.maxDepth) return Array.isArray(value) ? `[array(${value.length})]` : '[object]';
        seen.add(value);
        if (typeof value.toArray === 'function' && value.isVector3) return value.toArray();
        if (value instanceof Error) return { name: value.name, message: clip(value.message) };
        if (Array.isArray(value) || ArrayBuffer.isView(value)) {
            const total = value.length ?? 0, take = Math.min(total, LIMITS.maxList), out = [];
            for (let i = 0; i < take; i++) out.push(plain(value[i], depth + 1, seen, ctx)); // never materialise the whole array
            if (total > take) out.push(`... ${total - take} more`);
            return out;
        }
        if (value instanceof Set || (typeof value.forEach === 'function' && typeof value.size === 'number' && typeof value.add === 'function')) {
            return { type: 'set', size: value.size, sample: plain((() => { const first = []; for (const x of value) { if (first.length >= 20) break; first.push(x); } return first; })(), depth + 1, seen, ctx) };
        }
        if (value instanceof Map) return { type: 'map', size: value.size };
        if ('n3' in value && 'n5' in value && 'id' in value) return { element: value.constructor?.name ?? 'element', id: value.id, strand: value.strand?.id ?? null };
        if (typeof value.getLength === 'function' && 'id' in value && 'system' in value) {
            return { strand: value.id, length: safe(() => value.getLength(), null) };
        }
        const out = {};
        let n = 0;
        for (const k of Object.keys(value)) {
            if (n++ >= 40) { out['...'] = 'more keys'; break; }
            try { out[k] = plain(value[k], depth + 1, seen, ctx); } catch (_) { out[k] = '[unreadable]'; }
        }
        return out;
    }
    const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };

    // ── scene reading ────────────────────────────────────────────────────────────────────────────────────────────────
    function eachElement(system, fn) {
        for (const strand of system.strands ?? []) {
            if (typeof strand.forEach === 'function') strand.forEach((e) => fn(e, strand));
        }
    }

    function inspect() {
        const elements = readGlobal('elements');
        const systems = readGlobal('systems') ?? [];
        const selected = readGlobal('selectedBases');
        const perSystem = [];
        let strands = 0, monomers = 0;
        systems.forEach((system, index) => {
            let count = 0, rna = 0;
            safe(() => eachElement(system, (e) => { count += 1; if (typeof e.isRNA === 'function' && e.isRNA()) rna += 1; }), null);
            const nStrands = system.strands?.length ?? 0;
            strands += nStrands; monomers += count;
            perSystem.push({ index, id: system.id ?? index, strands: nStrands, monomers: count, rna, dna: count - rna });
        });
        const total = typeof elements?.size === 'number' ? elements.size : monomers;
        const api = window.api;
        return {
            version: VERSION,
            nucleotideCount: total,
            nucleotides: total,
            monomerCountBySystems: monomers,
            strandCount: strands,
            systemCount: systems.length,
            systems: perSystem.slice(0, LIMITS.maxList),
            selectionCount: typeof selected?.size === 'number' ? selected.size : 0,
            hasScene: total > 0,
            apiNamespaces: Object.keys(window).filter((k) => /^(api|space|transform|llmTracker|shapes|spatial)/i.test(k)).slice(0, 30),
            hasApi: !!api,
        };
    }

    function validate() {
        const systems = readGlobal('systems') ?? [];
        const elements = readGlobal('elements');
        const errors = [];
        const add = (code, message, id = null) => { if (errors.length < LIMITS.maxValidationErrors) errors.push({ code, message, id }); counts[code] = (counts[code] ?? 0) + 1; };
        const counts = {};
        let checked = 0, links = 0;
        try {
            for (const system of systems) {
                eachElement(system, (e) => {
                    checked += 1;
                    if (e.n3) { links += 1; if (e.n3.n5 !== e) add('AsymmetricLink', `n3 of ${e.id} does not point back through n5`, e.id); }
                    if (e.n5 && e.n5.n3 !== e) add('AsymmetricLink', `n5 of ${e.id} does not point back through n3`, e.id);
                    const p = safe(() => e.getPos(), null);
                    if (p && !Number.isFinite(p.x + p.y + p.z)) add('BadPosition', `element ${e.id} has a non-finite position`, e.id);
                });
            }
            if (typeof elements?.size === 'number' && checked && elements.size !== checked) add('CountMismatch', `scene map holds ${elements.size} elements but systems contain ${checked}`);
        } catch (e) {
            add('ValidationError', `validation could not finish: ${e.message}`);
        }
        return { ok: errors.length === 0, checked, links, counts, errors };
    }

    // ── code execution with structured diagnostics ──────────────────────────────────────────────────────────────────
    const HINTS = [
        [/is not defined/, 'Only documented viewer globals exist (elements, systems, selectedBases, api, ...). Read oxAgentRuntime.capabilities() and inspect the scene before referencing names.'],
        [/is not a function/, 'That method does not exist on this object. Check the name and the object type (Strand vs Nucleotide vs System) before calling it.'],
        [/Cannot read propert|Cannot set propert|undefined|null/, 'A value was missing. Inspect the scene first: the selection can be empty and a system may not be loaded yet.'],
        [/SyntaxError|Unexpected token|Unexpected identifier/, 'Fix the JavaScript syntax. Return plain code without markdown fences.'],
        [/timed out/i, 'Split the work into smaller steps; the operation may still finish in the background, so inspect before retrying a mutation.'],
    ];
    function describeError(e, code) {
        const name = e?.name ?? 'Error', message = String(e?.message ?? e);
        let line = null, column = null;
        // V8: "..., <anonymous>:L:C)" is the generated function's own frame (the earlier "eval at" part names this file); Firefox: "AsyncFunction:L:C".
        const stack = String(e?.stack ?? '');
        const m = /,\s*<anonymous>:(\d+):(\d+)\)/.exec(stack) || /AsyncFunction:(\d+):(\d+)/.exec(stack);
        // new Function bodies start on line 3 of the generated source.
        if (m) { line = Math.max(1, Number(m[1]) - 2); column = Number(m[2]); }
        const lines = String(code).split('\n');
        const hint = (HINTS.find(([re]) => re.test(`${name}: ${message}`)) ?? [null, 'Read the message, inspect the scene, and correct the statement named by line and source.'])[1];
        return { name, message: clip(message, 500), line, column, source: line ? clip(lines[line - 1] ?? '', 300) : null, hint };
    }

    function captureConsole(logs) {
        const original = {};
        for (const level of ['log', 'info', 'warn', 'error']) {
            original[level] = console[level];
            console[level] = (...args) => {
                if (logs.length < LIMITS.maxLogs) logs.push({ level, text: clip(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(plain(a)))).join(' '), 500) });
                try { original[level].apply(console, args); } catch (_) {}
            };
        }
        return () => { for (const level of Object.keys(original)) console[level] = original[level]; };
    }

    let chain = Promise.resolve();
    // Viewer mutations are not re-entrant: serialise requests so two agents cannot interleave edits.
    const enqueue = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`execution timed out after ${ms} ms`), { name: 'ViewerTimeout' })), ms); });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    function sceneCounts() {
        const elements = readGlobal('elements'), systems = readGlobal('systems') ?? [], selected = readGlobal('selectedBases');
        return { nucleotides: typeof elements?.size === 'number' ? elements.size : 0, systems: systems.length, selected: typeof selected?.size === 'number' ? selected.size : 0 };
    }

    /** Run code in its own async function scope. Never throws: a failure is the result. */
    function runCodeNow(code, { timeoutMs = LIMITS.defaultTimeoutMs, validateAfter = true } = {}) {
        return (async () => {
            if (typeof code !== 'string' || !code.trim()) return { ok: false, executed: false, error: { name: 'NoCode', message: 'code must be a nonempty string', hint: 'Pass the viewer JavaScript to run.' } };
            if (code.length > LIMITS.maxCodeChars) return { ok: false, executed: false, error: { name: 'CodeTooLong', message: `code is ${code.length} chars; the limit is ${LIMITS.maxCodeChars}`, hint: 'Split the work into several smaller steps.' } };
            const duration = Number.isFinite(timeoutMs) ? Math.min(LIMITS.maxTimeoutMs, Math.max(100, timeoutMs)) : LIMITS.defaultTimeoutMs;
            const logs = [], before = sceneCounts(), start = performance.now();
            const restore = captureConsole(logs);
            let value = null, error = null, fn;
            try { fn = new AsyncFunction(code); } catch (e) { error = describeError(e, code); }
            if (fn) {
                try { value = plain(await withTimeout(Promise.resolve(fn()), duration)); } catch (e) { error = describeError(e, code); }
            }
            restore();
            try { if (typeof render === 'function') render(); } catch (_) { /* rendering must not hide the result */ }
            const after = sceneCounts();
            const warnings = [];
            if (validateAfter && !error) {
                const v = validate();
                if (!v.ok) warnings.push({ code: 'TopologyWarning', message: `${v.errors.length}${v.errors.length >= LIMITS.maxValidationErrors ? '+' : ''} topology problem(s) after the run`, details: v.errors.slice(0, 5) });
            }
            return {
                ok: !error, executed: !!fn, elapsedMs: Math.round(performance.now() - start), value, logs, scene: { before, after },
                ...(error ? { error: { ...error }, diagnostics: [{ code: error.name, message: error.message, hint: error.hint }] } : {}),
                warnings,
            };
        })();
    }
    /** Queued: one run at a time. */
    const runCode = (code, opts) => enqueue(() => runCodeNow(code, opts));

    /** One compact text block for an LLM observer: error with line and hint, scene change, console output, warnings. */
    function describeRun(run) {
        if (!run.ok) {
            const e = run.error;
            return `ERROR: ${e.name}: ${e.message}${e.line ? ` (line ${e.line}${e.column ? `:${e.column}` : ''}${e.source ? `: ${e.source}` : ''})` : ''}\nHint: ${e.hint}\nScene unchanged? before ${JSON.stringify(run.scene?.before)} after ${JSON.stringify(run.scene?.after)}`;
        }
        const parts = ['SUCCESS'];
        const b = run.scene.before, a = run.scene.after;
        if (b.nucleotides !== a.nucleotides || b.systems !== a.systems) parts.push(`scene: nucleotides ${b.nucleotides} -> ${a.nucleotides}, systems ${b.systems} -> ${a.systems}`);
        if (run.value !== null && run.value !== undefined) parts.push(`returned: ${clip(JSON.stringify(run.value), 400)}`);
        for (const l of run.logs.filter((x) => x.level === 'error' || x.level === 'warn').slice(0, 5)) parts.push(`console.${l.level}: ${l.text}`);
        for (const w of run.warnings) parts.push(`warning: ${w.message}`);
        return parts.join('\n');
    }

    // ── headless viewer LLM task ────────────────────────────────────────────────────────────────────────────────────
    function llmReady() {
        const cfg = readGlobal('AGENT_CONFIG');
        return { available: typeof window.agentPlanner === 'function' && typeof window.agentExecutor === 'function' && typeof window.agentObserver === 'function', configured: !!cfg?.apiKey, model: cfg?.model ?? null };
    }

    async function taskNow(text, { maxRetries = 3, maxSteps = 8, timeoutMs = LIMITS.defaultTimeoutMs, llmTimeoutMs = LIMITS.defaultLlmTimeoutMs } = {}) {
        // Every model call is time-bounded so a provider that never answers cannot hold the queue forever.
        const llm = (promise) => withTimeout(Promise.resolve(promise), Number.isFinite(llmTimeoutMs) ? Math.min(LIMITS.maxTimeoutMs, Math.max(1000, llmTimeoutMs)) : LIMITS.defaultLlmTimeoutMs);
        const state = llmReady();
        if (!state.available) return { ok: false, error: 'The viewer LLM agent is not loaded in this build', diagnostics: [{ code: 'ViewerLLMUnavailable', message: 'agent_chat.js is not loaded', hint: 'Use execute with explicit viewer code instead.' }] };
        if (!state.configured) return { ok: false, error: 'No LLM API key is configured in the viewer', diagnostics: [{ code: 'ViewerLLMNotConfigured', message: 'no API key', hint: 'Set the key in the viewer Model & settings, or use execute with explicit code.' }] };
        if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'task must be a nonempty string' };
        const steps = [];
        let plan;
        try { plan = (await llm(window.agentPlanner(text))).slice(0, maxSteps); } catch (e) { return { ok: false, error: `planning failed: ${e.message}`, steps, diagnostics: [{ code: 'ViewerPlanFailed', message: e.message, hint: 'Rephrase the task as one concrete scene operation.' }] }; }
        for (const step of plan) {
            const record = { step: String(step), attempts: [], success: false };
            steps.push(record);
            let retryContext = '';
            for (let attempt = 0; attempt < maxRetries && !record.success; attempt++) {
                let code;
                try { code = await llm(window.agentExecutor(record.step, retryContext)); } catch (e) { record.attempts.push({ attempt, error: `code generation failed: ${e.message}` }); break; }
                const run = await runCodeNow(code, { timeoutMs });
                const text2 = describeRun(run);
                let observation;
                try { observation = await llm(window.agentObserver(record.step, code, text2)); } catch (_) { observation = { success: run.ok, feedback: 'Verification unavailable' }; }
                const success = run.ok && observation?.success !== false;
                record.attempts.push({ attempt, code, run: { ok: run.ok, error: run.error ?? null, scene: run.scene, logs: run.logs.slice(0, 10), warnings: run.warnings }, observation: safe(() => plain(observation), null) });
                record.success = success;
                retryContext = `${text2}\nObserver: ${observation?.feedback ?? ''}`;
            }
            if (!record.success) break;
        }
        const ok = steps.length > 0 && steps.length === plan.length && steps.every((s) => s.success);
        let summary = null;
        try { summary = await llm(window.agentSummarizer(text, steps.map((s) => ({ step: s.step, success: s.success })))); } catch (_) { /* summary is optional */ }
        return { ok, summary, steps, scene: inspect(), ...(ok ? {} : { error: 'the viewer agent did not complete every step', diagnostics: steps.filter((s) => !s.success).map((s) => ({ code: 'ViewerStepFailed', message: s.step, hint: 'Read the failed attempt code and run.error, then retry with execute.' })) }) };
    }

    /** Queued as ONE unit: a task's steps are not interleaved with other requests or other tasks. */
    const task = (text, opts) => enqueue(() => taskNow(text, opts));

    // ── public object and host protocol ─────────────────────────────────────────────────────────────────────────────
    function capabilities() {
        const llm = llmReady();
        const api = window.api && typeof window.api === 'object' ? Object.keys(window.api).filter((k) => typeof window.api[k] === 'function').sort() : [];
        return {
            version: VERSION, methods: METHODS.slice(), limits: { ...LIMITS },
            globals: ['elements', 'systems', 'selectedBases', 'tmpSystems', 'view'].filter((n) => readGlobal(n) !== undefined),
            api: api.slice(0, 200), llm,
            notes: 'execute runs async JavaScript in the viewer scope and returns structured errors; task uses the viewer LLM and needs a configured key.',
        };
    }

    const runtime = { version: VERSION, capabilities, inspect, validate, execute: (code, opts) => runCode(code, opts), runCode, describeRun, task, plain };
    window.oxAgentRuntime = runtime;

    const handlers = {
        capabilities: () => capabilities(),
        inspect: () => inspect(),
        validate: () => validate(),
        execute: (args) => runCode(args[0], { timeoutMs: args[1]?.timeoutMs }),
        task: (args) => task(args[0], args[1] ?? {}),
    };

    window.addEventListener('message', async (event) => {
        const d = event.data;
        if (!d || typeof d !== 'object' || d.type !== 'oxview_api_request') return;
        const port = event.ports && event.ports[0];
        if (!port) return; // there is no channel to answer on
        const reply = (payload) => { try { port.postMessage(payload); } catch (e) { try { port.postMessage({ id: d.id, ok: false, error: `result could not be cloned: ${e.message}` }); } catch (_) {} } };
        const fail = (code, message, hint) => reply({ id: d.id, ok: false, error: message, diagnostics: [{ code, message, hint }] });
        const trusted = event.origin === window.location.origin && (event.source === window.parent || event.source === window);
        if (!trusted) return fail('UntrustedSender', 'The request came from an untrusted frame or origin', 'Send from the embedding parent frame on the same origin.');
        if (typeof d.method !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, d.method)) return fail('UnknownMethod', `unknown method '${d.method}'`, `Use one of: ${METHODS.join(', ')}.`);
        try {
            const result = await handlers[d.method](Array.isArray(d.args) ? d.args : []);
            reply({ id: d.id, ok: true, result: plain(result, 0) });
        } catch (e) {
            fail(e?.name ?? 'ViewerError', String(e?.message ?? e), 'The viewer rejected the request; inspect the scene and retry.');
        }
    });
})();
