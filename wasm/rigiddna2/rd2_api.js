// JavaScript side of the WebAssembly build (docs/29_webassembly.md): turns an options object into the command line of rd2_run, runs it on the
// in-memory file system of the module and collects the result. Works in a Web Worker (importScripts), in a page and in Node (require).
(function (root) {
  'use strict';

  // options -> rd2_run arguments (one per entry). Unknown keys are ignored; `extra` is appended verbatim for every other rd2_run option.
  function buildArgs(o) {
    o = o || {};
    const a = [];
    const oneOf = (v, set, what) => { if (v !== undefined && set.indexOf(v) < 0) throw new Error(what + ' must be one of ' + set.join(', ')); return v; };
    if (o.route && oneOf(o.route, ['auto', 'lattice', 'wireframe', 'articulated', 'ring'], 'route') !== 'auto') a.push('--route', o.route);
    if (o.inferStaples !== undefined) a.push('--infer-staples', oneOf(String(o.inferStaples === true ? 'on' : o.inferStaples === false ? 'off' : o.inferStaples), ['auto', 'on', 'off'], 'inferStaples'));
    if (o.lattice && o.lattice !== 'auto') a.push('--lattice', oneOf(o.lattice, ['square', 'honeycomb'], 'lattice'));
    if (o.native === false) a.push('--no-native');
    if (o.nativeIters > 0) a.push('--native-iters', String(Math.floor(o.nativeIters)));
    if (o.seed !== undefined) a.push('--seed', String(Math.floor(o.seed)));
    a.push('--threads', String(Math.max(1, Math.floor(o.threads || 1))));
    if (Array.isArray(o.extra)) for (const x of o.extra) a.push(String(x));
    return a;
  }

  // File name extension that rd2_run's format detection needs (.json caDNAno, .sc scadnano, .top oxDNA).
  function extensionOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
    const e = m ? m[1].toLowerCase() : 'json';
    return e === 'sc' || e === 'top' ? e : 'json';
  }

  // Module configuration for createRd2Module(): stdout / stderr of the program are forwarded to whatever run() installs as the current sink.
  let currentSink = (line) => { if (typeof console !== 'undefined') console.log(line); };
  function moduleConfig(extra) {
    return Object.assign({ print: (l) => currentSink(l), printErr: (l) => currentSink(l) }, extra || {});
  }

  // Runs one design. M: an initialised module (createRd2Module(Rd2Api.moduleConfig())). input: {name, text, dat?} (dat: configuration text of an oxDNA .top design).
  // opts: see buildArgs. hooks: {onProgress(event) (returning false cancels the run: rc 3), onLog(line)}. Resolves to {rc, top, dat, summary, log, seconds} (top/dat/summary null when nothing was written).
  function run(M, input, opts, hooks) {
    hooks = hooks || {};
    const FS = M.FS;
    const log = [];
    const sink = (line) => { log.push(line); if (hooks.onLog) hooks.onLog(line); };
    currentSink = sink;
    M.onRd2Progress = (json) => {   // an onProgress that returns false cancels the run
      if (!hooks.onProgress) return true;
      try { return hooks.onProgress(JSON.parse(json)); } catch (e) { return true; }
    };
    try { FS.mkdir('/work'); } catch (e) { /* exists */ }
    const ext = extensionOf(input.name);
    const inPath = '/work/design.' + ext, prefix = '/work/out';
    const outs = [prefix + '.top', prefix + '.dat', prefix + '.summary.json'];
    for (const p of outs.concat([inPath, '/work/design.dat'])) { try { FS.unlink(p); } catch (e) { /* not there */ } }
    FS.writeFile(inPath, input.text);
    const args = buildArgs(opts);
    if (ext === 'top' && input.dat !== undefined) { FS.writeFile('/work/design.dat', input.dat); args.push('--dat', '/work/design.dat'); }
    const t0 = Date.now();
    const rc = M.ccall('rd2w_run', 'number', ['string', 'string', 'string'], [inPath, prefix, args.join('\n')]);
    const seconds = (Date.now() - t0) / 1000;
    const read = (p) => { try { return FS.readFile(p, { encoding: 'utf8' }); } catch (e) { return null; } };
    const res = { rc, top: read(outs[0]), dat: read(outs[1]), summary: null, log: log.join('\n'), seconds };
    const s = read(outs[2]);
    if (s) { try { res.summary = JSON.parse(s); } catch (e) { /* leave null */ } }
    for (const p of outs.concat([inPath, '/work/design.dat'])) { try { FS.unlink(p); } catch (e) { /* not there */ } }
    return res;
  }

  const api = { buildArgs, extensionOf, moduleConfig, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Rd2Api = api;
})(typeof self !== 'undefined' ? self : globalThis);
