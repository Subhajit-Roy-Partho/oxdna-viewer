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
    if (o.method !== undefined && !['v2', 'nested', 'hint', 'v3', 'v4', 'm2', 'h2d', 'ml2', 'ml3', 'ms2', 'msrna', 'dna', 'ssdna', 'rna_kl', 'kl_routes', 'longrange', 'cassette', 'nat1', 'e1', 'e1k50', 'ml4', 'ms3', 'domainB', 'hybridB', 'auto', 'score', 'bld2', 'centroid', 'mea', 'oxpairs', 'oriLayout', 'annotate3d', 'evalPairs', 'fail1Lib', 'rf'].includes(o.method)) throw new SeqpredError('method must be one of v2, nested, hint, v3, v4, m2, h2d, ml2, ml3, ms2, msrna, dna, ssdna, rna_kl, kl_routes, longrange, cassette, nat1, e1, e1k50, ml4, ms3, domainB, hybridB, auto, score, bld2, centroid, mea, oxpairs');
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
    // Base pairs of an oxDNA / oxRNA configuration (C++ port of runall.refs.oxdna_pairs, geometric criterion): the reference of a loaded or pasted model.
    //   request = {top: text, dat: text, molecule?: 'RNA' | 'DNA' (default RNA), minStack?: int, hbMax?: number}  -> {ok, pairs (1-based, 5'->3'), sequence, strands?, n, dotbracket, nGeo, compGeo, compGeoReversed, notes}
    // The request text of a big configuration (a DNA origami: MB) does not fit the 4 MB stack that ccall's 'string' arguments use: the strings go to the heap.
    // CPP-7: the request of a method that takes no sequence goes to the heap (a PDB / mmCIF text or a pair list of a DNA origami is MB-sized), result = the JSON object
    const callRaw = (method, request) => {
      const txt = JSON.stringify(Object.assign({}, request, { method }));
      const nb = M.lengthBytesUTF8(txt) + 1, mp = M._malloc(nb), sp0 = M._malloc(1);
      let ptr;
      try {
        M.stringToUTF8(txt, mp, nb);
        M.HEAPU8[sp0] = 0;
        ptr = M.ccall('seqpred_predict', 'number', ['number', 'number'], [sp0, mp]);
      } finally { M._free(mp); M._free(sp0); }
      const s = M.UTF8ToString(ptr);
      M.ccall('seqpred_free', null, ['number'], [ptr]);
      return JSON.parse(s);
    };
    const callMethod = (method, request) => {
      const r = callRaw(method, request);
      if (!r.ok) throw new SeqpredError(r.error);
      return r;
    };
    // CPP-10: the C++ ports of the rd2 server modules.  Each is a stateless function of an operation name and its arguments (see src/seqpred/srv.h, docs/124_cpp10.md): returns the result of the
    // Python function of the same name; a refusal of the Python (InputError, RefError, DbnError, StageFail) is thrown as SeqpredError with .errorType and .status (400 for InputError).
    const srvCall = (method) => (op, request) => {
      const r = callRaw(method, Object.assign({}, request, { op }));
      if (!r.ok) { const e = new SeqpredError(r.error); e.errorType = r.errorType; if (r.status !== undefined) e.status = r.status; throw e; }
      return r.result;
    };
    const seqInput = srvCall('seqInput');       // scripts/rd2_server/seqinput.py: parse | checkStructure | hasCrossing | validate | resolveModels | describe | catalog | checkSize | checkModelRange
    const pairScore = srvCall('pairScore');     // scripts/rd2_server/pairscore.py: normalize | crossing | score | classify | tsv | dotbracketPairs | pairlistPairs | topSequence | oxdnaPairs
    const dotBracket = srvCall('dotBracket');   // scripts/rd2_server/dotbracket.py: pairsToDotbracket | dropUnstacked | topHeader | resolveMolecule | checkConfSize | fromOxdna | sniff | fromStructure | parseChains | convert | newToOld | isNewTopology
    const seqPipe = srvCall('seqPipe');         // pure parts of scripts/rd2_server/seqpipe.py: pairsToDb | explain | backbone | resolveBuild | isDesignedOrigami | leftOutPairs | sheetSentence | v3dBudget | layoutDesign | bld2Design | reportTexts
    const oxPairs = (request) => callMethod('oxpairs', request);
    // Layout stages of the DNA-origami route (ORI-1 / ORI-2; C++ port, CPP-7): request = {lens: [scaffold, staple1, ...], pairs: [[i, j], ...] (1-based, global), mode?: 'ori1' | 'ori2', params?, detail?, doc?}
    const oriLayout = (request) => callMethod('oriLayout', request);
    // Base pairs of a PDB / mmCIF structure text (rd2rna annotator, C++ port, CPP-7): request = {text, format?: 'pdb' | 'cif', model?: 1, chains?: [ids]}
    const annotate3d = (request) => callMethod('annotate3d', request);
    // Pair-list evaluation (scripts/seqpred/eval.py): request = {native, pred, n?, lengths?, minLong?}
    const evalPairs = (request) => callMethod('evalPairs', request);
    // Rfam-transfer / ring helpers that need no Infernal (CPP-7): request = {op, ...arguments}
    const fail1Lib = (request) => callMethod('fail1Lib', request);
    // The 3D structure of a prediction with the existing rd2_rna engine (rd2rna_api.js, module createRd2RnaModule): the predicted dot-bracket (layers as [] {} <>) is the design.
    async function build3d(result, rd2Api, rd2Module, options) {
      const res = rd2Api.run(rd2Module, { seq: result.sequence, db: result.dotbracket }, Object.assign({ threads: 1 }, options || {}));
      return Object.assign(res, { source: { method: result.method, salt: result.salt, seqpred: result.version } });
    }
    // bld2 (lane CPP-5): the fragment-assembly RNA 3D builder of lane BUILD-1.  The motif library (bld2_lib.bin, ~7 MB, 5.5 MB gzip) is NOT inside the module: load it once with loadBld2Library(bytes).
    //   const info = sp.loadBld2Library(new Uint8Array(await (await fetch('bld2_lib.bin')).arrayBuffer()));
    //   const m = sp.buildBld2(sequence, pairs | dotbracket, {oxrna: true});     // -> {ok, pdb, oxrna: {top, dat, pieces, nicksAfter5to3Index}, loops: [...instance choices], notes, ...}
    let bld2Info = null;
    const loadBld2Library = (bytes) => {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const p = M._malloc(u8.length);
      M.HEAPU8.set(u8, p);
      let s;
      try {
        const rp = M.ccall('seqpred_bld2_load', 'number', ['number', 'number'], [p, u8.length]);
        s = M.UTF8ToString(rp);
        M.ccall('seqpred_free', null, ['number'], [rp]);
      } finally { M._free(p); }
      const r = JSON.parse(s);
      if (!r.ok) throw new SeqpredError(r.error);
      bld2Info = r;
      return r;
    };
    const buildBld2 = (sequence, structure, options) => {
      const o = Object.assign({ oxrna: true }, options || {}, { method: 'bld2' });
      if (typeof structure === 'string') o.dotbracket = structure; else if (Array.isArray(structure)) o.pairs = structure;
      else throw new SeqpredError('bld2 needs a dot-bracket string or a pair list');
      const ptr = M.ccall('seqpred_predict', 'number', ['string', 'string'], [String(sequence).replace(/\s+/g, ''), JSON.stringify(o)]);
      const s = M.UTF8ToString(ptr);
      M.ccall('seqpred_free', null, ['number'], [ptr]);
      const r = JSON.parse(s);
      if (!r.ok) throw new SeqpredError(r.error);
      return r;
    };
    return { predict, predictRaw, version, build3d, score, oxPairs, oriLayout, annotate3d, evalPairs, fail1Lib, seqInput, pairScore, dotBracket, seqPipe, callMethod, loadBld2Library, buildBld2, bld2Loaded: () => bld2Info, module: M, defaults: BROWSER_DEFAULTS };
  }

  const api = { load, SeqpredError, BROWSER_DEFAULTS, checkOptions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SeqpredApi = api;
})(typeof self !== 'undefined' ? self : globalThis);
