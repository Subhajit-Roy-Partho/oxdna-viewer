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
    if (o.method !== undefined && !['v2', 'nested', 'hint', 'v3', 'msrna', 'dna', 'ssdna', 'rna_kl', 'kl_routes', 'longrange', 'cassette'].includes(o.method)) throw new SeqpredError('method must be one of v2, nested, hint, v3, msrna, dna, ssdna, rna_kl, kl_routes, longrange, cassette');
    for (const k of ['threads', 'maxLength']) if (o[k] !== undefined) o[k] = Math.max(0, Math.floor(Number(o[k])));
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
    // The 3D structure of a prediction with the existing rd2_rna engine (rd2rna_api.js, module createRd2RnaModule): the predicted dot-bracket (layers as [] {} <>) is the design.
    async function build3d(result, rd2Api, rd2Module, options) {
      const res = rd2Api.run(rd2Module, { seq: result.sequence, db: result.dotbracket }, Object.assign({ threads: 1 }, options || {}));
      return Object.assign(res, { source: { method: result.method, salt: result.salt, seqpred: result.version } });
    }
    return { predict, predictRaw, version, build3d, module: M, defaults: BROWSER_DEFAULTS };
  }

  const api = { load, SeqpredError, BROWSER_DEFAULTS, checkOptions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SeqpredApi = api;
})(typeof self !== 'undefined' ? self : globalThis);
