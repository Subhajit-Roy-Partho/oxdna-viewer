// JavaScript side of the rigidRNA WebAssembly build: turns an options object into the command line of rd2_rna, runs it on the in-memory file system of
// the module and collects the result. Works in a Web Worker (importScripts), in a page and in Node (require).
(function (root) {
  'use strict';
  const PARAMS = '/rd2/params/rna_elements_v1.json', TEMPLATE = '/rd2/params/rna_bp_template.json';

  // options -> rd2_rna arguments (one per entry). Unknown keys are ignored; `extra` is appended verbatim for every other rd2_rna option.
  //   salt (mol/l, default 0.5) and temp (K) go into the oxRNA2 inputs and, with elec, into the Debye-Hueckel term of the rigid model; elec: electrostatics in the
  //   rigid model (rd2_rna --elec); layout: de novo layout of the stems (always on for a sequence + dot-bracket input); iters: LM iterations.
  function buildArgs(o) {
    o = o || {};
    const a = [];
    if (o.salt !== undefined) a.push('--salt', String(Number(o.salt)));
    if (o.temp !== undefined) a.push('--temp', String(Number(o.temp)));
    if (o.elec) { a.push('--elec'); if (o.elecScale !== undefined) a.push('--elec-scale', String(Number(o.elecScale))); }
    if (o.layout) a.push('--layout');
    if (o.iters > 0) a.push('--iters', String(Math.floor(o.iters)));
    if (o.dmin > 0) a.push('--dmin', String(Number(o.dmin)));
    if (o.krep > 0) a.push('--krep', String(Number(o.krep)));
    if (o.noRelax) a.push('--no-relax');
    a.push('--threads', String(Math.max(1, Math.floor(o.threads || 1))));
    if (Array.isArray(o.extra)) for (const x of o.extra) a.push(String(x));
    return a;
  }

  // Module configuration for createRd2RnaModule(): stdout / stderr of the program are forwarded to whatever run() installs as the current sink.
  let currentSink = (line) => { if (typeof console !== 'undefined') console.log(line); };
  function moduleConfig(extra) {
    return Object.assign({ print: (l) => currentSink(l), printErr: (l) => currentSink(l) }, extra || {});
  }

  const OUTS = ['top', 'dat', 'report.json', 'flags.json', 'substruct.json', 'poses.csv', 'map'];

  // Runs one structure. M: an initialised module. input: {seq, db} (sequence + dot-bracket, pseudoknots as [] {} <> ; de novo layout) or {top, dat, pairs}
  // (3D start: oxRNA .top/.dat texts and the base-pair list as the text of a json {"pairs": [[i, j], ...]}; with opts.layout the stems are laid out de novo from the pairs).
  // hooks: {onLog(line)}. Resolves to {rc, top, dat, report, flags, log, seconds}.
  function run(M, input, opts, hooks) {
    hooks = hooks || {};
    const FS = M.FS;
    const log = [];
    currentSink = (line) => { log.push(line); if (hooks.onLog) hooks.onLog(line); };
    try { FS.mkdir('/work'); } catch (e) { /* exists */ }
    const prefix = '/work/out';
    const clean = () => {
      for (const e of OUTS) { try { FS.unlink(prefix + '.' + e); } catch (x) { /* not there */ } }
      for (const p of ['/work/in.top', '/work/in.dat', '/work/in.pairs.json']) { try { FS.unlink(p); } catch (x) { /* not there */ } }
    };
    clean();
    const args = [];
    if (input.top !== undefined) {
      FS.writeFile('/work/in.top', input.top); FS.writeFile('/work/in.dat', input.dat); FS.writeFile('/work/in.pairs.json', input.pairs);
      args.push('--conf', '/work/in.top', '/work/in.dat', '--pairs', '/work/in.pairs.json');
    } else {
      args.push('--seq', String(input.seq).replace(/\s+/g, ''), '--db', String(input.db).replace(/\s+/g, ''));
    }
    args.push('--params', PARAMS, '--template', TEMPLATE, '--out', prefix);
    const all = args.concat(buildArgs(opts));
    const t0 = Date.now();
    const rc = M.ccall('rd2rnaw_run', 'number', ['string'], [all.join('\n')]);
    const seconds = (Date.now() - t0) / 1000;
    const read = (e) => { try { return FS.readFile(prefix + '.' + e, { encoding: 'utf8' }); } catch (x) { return null; } };
    const json = (t) => { try { return t ? JSON.parse(t) : null; } catch (x) { return null; } };
    const res = { rc, top: read('top'), dat: read('dat'), report: json(read('report.json')), flags: json(read('flags.json')), log: log.join('\n'), seconds };
    clean();
    return res;
  }

  const api = { buildArgs, moduleConfig, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Rd2RnaApi = api;
})(typeof self !== 'undefined' ? self : globalThis);
