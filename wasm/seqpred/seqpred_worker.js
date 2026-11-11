// Web Worker that hosts the seqpred WebAssembly module: the page never blocks (the computation is one synchronous call in this worker; the page cancels by terminating it).
//   {type:'init', base, variant, build}             load <base>/seqpred_api.js and <base>/seqpred_<variant>.js  (variant 'mt': threaded build, needs crossOriginIsolated; falls back to 'st');
//                                            `build` (optional): build id of build.json, appended as ?v=<build> to every file so that a browser cache cannot serve another build
//   {type:'predict', id, sequence, options}  -> {type:'result', id, result}  |  {type:'error', id, message}
//   {type:'oxpairs', id, request}           -> {type:'oxpaired', id, result}  |  {type:'error', id, message}   (base pairs of an oxDNA / oxRNA configuration: request {top, dat, molecule?, minStack?})
//   {type:'score', id, request}             -> {type:'scored', id, result}  |  {type:'error', id, message}   (scoring of a predicted pair set against a reference structure, C++ port of runall.metrics)
//   {type:'bld2lib', id, bytes (ArrayBuffer)}  -> {type:'bld2loaded', id, info}   (motif library of the bld2 3D builder, loaded once into the module)
//   {type:'bld2', id, sequence, structure (pairs or dot-bracket), options}  -> {type:'bld2built', id, result, wallSeconds}
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
    } else if (m.type === 'bld2lib') {
      self.postMessage({ type: 'bld2loaded', id: m.id, info: sp.loadBld2Library(m.bytes) });
    } else if (m.type === 'bld2') {
      const t0 = Date.now();
      const result = sp.buildBld2(m.sequence, m.structure, m.options);
      self.postMessage({ type: 'bld2built', id: m.id, result, wallSeconds: (Date.now() - t0) / 1000 });
    } else if (m.type === 'oxpairs') {
      self.postMessage({ type: 'oxpaired', id: m.id, result: sp.oxPairs(m.request) });
    } else if (m.type === 'score') {
      self.postMessage({ type: 'scored', id: m.id, result: sp.score(m.request) });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) });
  }
};
}
