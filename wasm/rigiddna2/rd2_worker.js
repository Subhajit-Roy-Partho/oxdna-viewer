// Web Worker that hosts the rigidDNA2 WebAssembly module (docs/29_webassembly.md). The page never blocks: the computation is one synchronous call
// inside this worker (which itself starts the OpenMP threads as further workers, running this same file); the page cancels by terminating the worker.
//
// Messages to the worker:   {type:'init', base, variant:'mt'|'st', threads}      load <base>/rd2_<variant>.js
//                           {type:'run', id, name, text, dat?, options}          options: route, inferStaples, linkers, native, threads, lattice, seed, extra
// Messages from the worker: {type:'ready', variant, threads, version}  {type:'progress', id, ...event}  {type:'log', id, line}
//                           {type:'result', id, rc, top, dat, summary, log, seconds}  {type:'error', id, message}
'use strict';
// The threaded module starts its OpenMP threads as Web Workers running this very script (Emscripten uses the URL of the script that created the module):
// in such a worker the module's own bootstrap is all that must run.
if (self.name === 'em-pthread') {
  importScripts(new URL('rd2_mt.js', self.location.href).href);
} else {
let M = null, variant = 'st', maxThreads = 1;
let base = '';

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      base = m.base.replace(/\/?$/, '/');
      variant = m.variant === 'mt' ? 'mt' : 'st';
      importScripts(base + 'rd2_api.js', base + 'rd2_' + variant + '.js');
      M = await createRd2Module(self.Rd2Api.moduleConfig({ locateFile: (p) => base + p }));
      maxThreads = M.ccall('rd2w_max_threads', 'number', [], []);
      self.postMessage({ type: 'ready', variant, threads: maxThreads, version: M.ccall('rd2w_version', 'string', [], []) });
    } else if (m.type === 'run') {
      const opts = Object.assign({}, m.options);
      opts.threads = Math.max(1, Math.min(opts.threads || maxThreads, maxThreads));
      const res = self.Rd2Api.run(M, { name: m.name, text: m.text, dat: m.dat }, opts, {
        onProgress: (e) => self.postMessage(Object.assign({ type: 'progress', id: m.id }, e)),
        onLog: (line) => self.postMessage({ type: 'log', id: m.id, line }),
      });
      self.postMessage({ type: 'result', id: m.id, rc: res.rc, top: res.top, dat: res.dat, summary: res.summary, log: res.log, seconds: res.seconds, threads: opts.threads });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) });
  }
};
}
