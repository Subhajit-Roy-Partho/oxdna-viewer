// JavaScript side of the seqpred WebAssembly module: sequence in, secondary structure out (nested MFE + kissing / pseudoknot layer of predictor v2), in the browser, no server.
// Works in a Web Worker (importScripts), in a page and in Node (require).  Typed contract: seqpred_api.d.ts.  Design and limits: docs/70_seqpred_cpp.md.
//
//   const sp = await SeqpredApi.load(createSeqpredModule, {locateFile});          // once
//   const r  = sp.predict('GGGG...', {salt: 0.25});                               // synchronous (blocks the thread: run it in a Worker, seqpred_worker.js)
//   r.dotbracket, r.pairs (1-based), r.layers, r.helices, r.energy, r.notes, r.timings, r.version
//   const s3 = await sp.build3d(r, rd2rnaApi, rd2rnaModule, {salt: 0.5});         // existing rd2_rna engine: sequence + predicted dot-bracket -> oxRNA .top/.dat
(function (root) {
  'use strict';

  // Browser limits (docs/70_seqpred_cpp.md section 7): the long-range search is the expensive part (seconds for 100-200 nt, minutes for 400 nt in the single-thread module, hours beyond 1000 nt): longer sequences get the nested MFE only unless maxLength: 0 is passed.
  const BROWSER_DEFAULTS = { maxLength: 600, budgetSeconds: 0 };

  class SeqpredError extends Error {}

  function checkOptions(o) {
    o = Object.assign({}, o || {});
    if (o.salt !== undefined && !(Number(o.salt) > 0)) throw new SeqpredError('salt must be a positive number (mol/L)');
    if (o.method !== undefined && !['v2', 'nested', 'hint', 'v3', 'v4', 'm2', 'h2d', 'ml2', 'ml3', 'ms2', 'msrna', 'dna', 'ssdna', 'rna_kl', 'kl_routes', 'longrange', 'cassette', 'nat1', 'e1', 'e1k50', 'ml4', 'ms3', 'domainB', 'hybridB', 'auto', 'score'].includes(o.method)) throw new SeqpredError('method must be one of v2, nested, hint, v3, v4, m2, h2d, ml2, ml3, ms2, msrna, dna, ssdna, rna_kl, kl_routes, longrange, cassette, nat1, e1, e1k50, ml4, ms3, domainB, hybridB, auto, score');
    if (o.model !== undefined && !['v2', 'v3', 'v4', 'm2', 'h2d', 'ml2', 'ml3', 'nat1', 'e1', 'e1k50', 'ml4'].includes(o.model)) throw new SeqpredError('model must be one of v2, v3, v4, m2, h2d, ml2, ml3, nat1, e1, e1k50, ml4');
    if (o.k !== undefined && ![30, 50].includes(Number(o.k))) throw new SeqpredError('k (ENERGY-1 pre-filter) must be 30 or 50');
    if (o.gateMargin !== undefined && !(Number.isFinite(Number(o.gateMargin)) && Number(o.gateMargin) >= 0)) throw new SeqpredError('gateMargin must be a finite number >= 0');
    for (const k of ['threads', 'maxLength']) if (o[k] !== undefined) o[k] = Math.max(0, Math.floor(Number(o[k])));
    if (o.thr !== undefined && !(Number(o.thr) >= 0 && Number(o.thr) <= 1)) throw new SeqpredError('thr must be a probability in [0, 1]');
    if (o.budgetSeconds !== undefined) o.budgetSeconds = Math.max(0, Number(o.budgetSeconds));
    return o;
  }

  // factory: createSeqpredModule (the Emscripten factory); config: {locateFile}
  async function load(factory, config) {
    const M = await factory(Object.assign({ print: () => {}, printErr: () => {} }, config || {}));
    const call = (fn, args) => {
      const ptr = M.ccall(fn, 'number', args.map(() => 'string'), args);
      const s = M.UTF8ToString(ptr);
      M.ccall('seqpred_free', null, ['number'], [ptr]);
      return s;
    };
    const version = () => JSON.parse(M.ccall('seqpred_version', 'string', [], []) || '{}');
    // raw: the JSON text of the result
    const predictRaw = (sequence, options) => {
      const o = Object.assign({}, BROWSER_DEFAULTS, checkOptions(options));
      const ptr = M.ccall('seqpred_predict', 'number', ['string', 'string'], [String(sequence).replace(/\s+/g, ''), JSON.stringify(o)]);
      const s = M.UTF8ToString(ptr);
      M.ccall('seqpred_free', null, ['number'], [ptr]);
      return s;
    };
    const predict = (sequence, options) => {
      const r = JSON.parse(predictRaw(sequence, options));
      if (!r.ok) throw new SeqpredError(r.error);
      return r;
    };
    // Score a predicted pair set against a reference structure (C++ port of scripts/seqpred/runall/metrics.py + the text loaders of runall/refs.py).
    //   request = {reference: {format: 'dotbracket'|'pairs'|'bpseq'|'ct', text}, prediction: {pairs: [[i, j], ...]} | {dotbracket}, n?, options?: {nested, minHelix, helixFrac, regions}}  (1-based pairs)
    //   -> {ok, reference: {n, nPairs, kind, source, notes}, score: {precision, recall, f1, mcc, cross_recall, cross_precision, pk_found, false_helix, ...}}
    const score = (request) => {
      const ptr = M.ccall('seqpred_predict', 'number', ['string', 'string'], ['', JSON.stringify({ method: 'score', request })]);
      const s = M.UTF8ToString(ptr);
      M.ccall('seqpred_free', null, ['number'], [ptr]);
      const r = JSON.parse(s);
      if (!r.ok) throw new SeqpredError(r.error);
      return r;
    };
    // The 3D structure of a prediction with the existing rd2_rna engine (rd2rna_api.js, module createRd2RnaModule): the predicted dot-bracket (layers as [] {} <>) is the design.
    async function build3d(result, rd2Api, rd2Module, options) {
      const res = rd2Api.run(rd2Module, { seq: result.sequence, db: result.dotbracket }, Object.assign({ threads: 1 }, options || {}));
      return Object.assign(res, { source: { method: result.method, salt: result.salt, seqpred: result.version } });
    }
    return { predict, predictRaw, version, build3d, score, module: M, defaults: BROWSER_DEFAULTS };
  }

  const api = { load, SeqpredError, BROWSER_DEFAULTS, checkOptions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SeqpredApi = api;
})(typeof self !== 'undefined' ? self : globalThis);
