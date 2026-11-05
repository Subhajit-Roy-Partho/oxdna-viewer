// Web Worker that hosts the seqpred WebAssembly module: the page never blocks (the computation is one synchronous call in this worker; the page cancels by terminating it).
//   {type:'init', base, variant, build}             load <base>/seqpred_api.js and <base>/seqpred_<variant>.js  (variant 'mt': threaded build, needs crossOriginIsolated; falls back to 'st');
//                                            `build` (optional): build id of build.json, appended as ?v=<build> to every file so that a browser cache cannot serve another build
//   {type:'predict', id, sequence, options}  -> {type:'result', id, result}  |  {type:'error', id, message}
//   {type:'ready', version}
'use strict';
if (self.name === 'em-pthread') {
  importScripts(new URL('seqpred_mt.js', self.location.href).href + (self.location.search || ''));
} else {
let sp = null;
self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      const base = m.base.replace(/\/?$/, '/');
      const variant = m.variant === 'mt' && self.crossOriginIsolated ? 'mt' : 'st';
      const q = m.build ? '?v=' + encodeURIComponent(m.build) : '';
      importScripts(base + 'seqpred_api.js' + q, base + 'seqpred_' + variant + '.js' + q);
      sp = await self.SeqpredApi.load(self.createSeqpredModule, { locateFile: (p) => base + p + q });
      self.postMessage({ type: 'ready', variant, version: sp.version() });
    } else if (m.type === 'predict') {
      const t0 = Date.now();
      const result = sp.predict(m.sequence, m.options);
      self.postMessage({ type: 'result', id: m.id, result, wallSeconds: (Date.now() - t0) / 1000 });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) });
  }
};
}
