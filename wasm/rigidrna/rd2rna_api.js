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
    if (o.minStem > 0) a.push('--min-stem', String(Math.floor(o.minStem)));
    if (o.noGu) a.push('--no-gu');
    if (o.noRodnet) a.push('--no-rodnet');
    if (o.noEmbed) a.push('--no-embed');
    if (o.noCompact) a.push('--no-compact');
    if (o.noSeedUnpaired) a.push('--no-seed-unpaired');
    if (o.foldCheck) a.push('--fold-check');
    if (o.maxSpan > 0) a.push('--maxspan', String(Math.floor(o.maxSpan)));
    if (o.gamma > 0) a.push('--gamma', String(Number(o.gamma)));
    for (const k of ['toehold', 'keepOpen', 'baseFlip', 'backFlip', 'hold'])
      if (Array.isArray(o[k])) for (const x of o[k]) a.push('--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), String(x));
    a.push('--threads', String(Math.max(1, Math.floor(o.threads || 1))));
    if (Array.isArray(o.extra)) for (const x of o.extra) a.push(String(x));
    return a;
  }

  // Module configuration for createRd2RnaModule(): stdout / stderr of the program are forwarded to whatever run() installs as the current sink.
  let currentSink = (line) => { if (typeof console !== 'undefined') console.log(line); };
  function moduleConfig(extra) {
    return Object.assign({ print: (l) => currentSink(l), printErr: (l) => currentSink(l) }, extra || {});
  }


  // Runs one structure. M: an initialised module. input, one of
  //   {seq, db}            sequence + dot-bracket (pseudoknots as [] {} <> and A a, '&' between strands); de novo layout
  //   {seq, predict}       sequence only, the secondary structure is predicted by the engine (Turner 2004): 'mfe' | 'mea' | 'probknot' | 'layers'
  //   {pdb, chains?, model?}  PDB or mmCIF text: nucleotide frames and Leontis-Westhof pairs computed by the engine (rna_pdb.cpp), 3D start (opts.layout: de novo from the pairs)
  //   {design}             design JSON (text or object) as in data/rna/designs
  //   {top, dat, pairs}    oxRNA .top/.dat texts and the base-pair list as the text of a json {"pairs": [[i, j], ...]}
  // hooks: {onLog(line)}. Resolves to {rc, top, dat, report, flags, overlay, substruct, forces, forcesProd, log, seconds}.
  function run(M, input, opts, hooks) {
    hooks = hooks || {};
    const FS = M.FS;
    const log = [];
    currentSink = (line) => { log.push(line); if (hooks.onLog) hooks.onLog(line); };
    try { FS.mkdir('/work'); } catch (e) { /* exists */ }
    const prefix = '/work/out';
    const clean = () => {   // every file of the previous run (outputs out.*, out_*.input, inputs in.*)
      let names = [];
      try { names = FS.readdir('/work'); } catch (x) { /* empty */ }
      for (const f of names) if (f !== '.' && f !== '..' && (f.startsWith('out') || f.startsWith('in.'))) { try { FS.unlink('/work/' + f); } catch (x) { /* directory */ } }
    };
    clean();
    const args = [];
    if (input.pdb !== undefined) {              // PDB / mmCIF text: converted and annotated by the engine itself (rd2_rna --pdb, src/rna_pdb.cpp)
      const isCif = /^_atom_site\./m.test(input.pdb);   // an mmCIF has the _atom_site loop header, a PDB file never does
      FS.writeFile('/work/in.' + (isCif ? 'cif' : 'pdb'), input.pdb);
      args.push('--pdb', '/work/in.' + (isCif ? 'cif' : 'pdb'));
      if (input.chains) args.push('--pdb-chains', Array.isArray(input.chains) ? input.chains.join(',') : String(input.chains));
      if (input.model !== undefined) args.push('--pdb-model', String(input.model));
    } else if (input.design !== undefined) {    // design JSON (rigidRNA data/rna/designs format)
      FS.writeFile('/work/in.json', typeof input.design === 'string' ? input.design : JSON.stringify(input.design));
      args.push('--json', '/work/in.json');
    } else if (input.top !== undefined) {
      FS.writeFile('/work/in.top', input.top); FS.writeFile('/work/in.dat', input.dat); FS.writeFile('/work/in.pairs.json', input.pairs);
      args.push('--conf', '/work/in.top', '/work/in.dat', '--pairs', '/work/in.pairs.json');
    } else if (input.predict) {                 // sequence only: secondary structure predicted by the engine (Turner 2004): mfe | mea | probknot | layers
      args.push('--seq', String(input.seq).replace(/\s+/g, ''), '--predict', String(input.predict));
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
    const res = { rc, top: read('top'), dat: read('dat'), report: json(read('report.json')), flags: json(read('flags.json')), overlay: json(read('overlay.json')), substruct: json(read('substruct.json')),
      forces: read('forces'), forcesProd: read('forces_prod'), log: log.join('\n'), seconds };
    clean();
    return res;
  }

  const api = { buildArgs, moduleConfig, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Rd2RnaApi = api;
})(typeof self !== 'undefined' ? self : globalThis);
