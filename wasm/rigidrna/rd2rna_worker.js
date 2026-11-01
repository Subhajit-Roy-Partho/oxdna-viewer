// Web Worker that hosts the rigidRNA WebAssembly module. The page never blocks: the computation is one synchronous call inside this worker (which itself starts
// the OpenMP threads as further workers, running this same file); the page cancels by terminating the worker.
//
// Messages to the worker:   {type:'init', base, variant:'mt'|'st'}                  load <base>/rd2rna_<variant>.js
//                           {type:'run', id, input, options}                         input {seq, db} | {top, dat, pairs}; options: see rd2rna_api.js buildArgs
// Messages from the worker: {type:'ready', variant, threads, version}  {type:'log', id, line}
//                           {type:'result', id, rc, top, dat, report, flags, log, seconds}  {type:'error', id, message}
'use strict';
if (self.name === 'em-pthread') {
  importScripts(new URL('rd2rna_mt.js', self.location.href).href);
} else {
let M = null, variant = 'st', maxThreads = 1;
let base = '';

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      base = m.base.replace(/\/?$/, '/');
      variant = m.variant === 'mt' ? 'mt' : 'st';
      importScripts(base + 'rd2rna_api.js', base + 'rd2rna_' + variant + '.js');
      M = await createRd2RnaModule(self.Rd2RnaApi.moduleConfig({ locateFile: (p) => base + p }));
      maxThreads = M.ccall('rd2rnaw_max_threads', 'number', [], []);
      self.postMessage({ type: 'ready', variant, threads: maxThreads, version: M.ccall('rd2rnaw_version', 'string', [], []) });
    } else if (m.type === 'run') {
      const opts = Object.assign({}, m.options);
      opts.threads = Math.max(1, Math.min(opts.threads || maxThreads, maxThreads));
      const res = self.Rd2RnaApi.run(M, m.input, opts, { onLog: (line) => self.postMessage({ type: 'log', id: m.id, line }) });
      self.postMessage({ type: 'result', id: m.id, rc: res.rc, top: res.top, dat: res.dat, report: res.report, flags: res.flags, log: res.log, seconds: res.seconds, threads: opts.threads });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) });
  }
};
}
