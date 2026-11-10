/**
 * rigidrna_ui.ts
 *
 * UI glue for the rigidRNA tab of windows/rigidDNAWindow.html: an RNA sequence with its dot-bracket structure, a sequence alone (the engine predicts the
 * structure), a PDB / mmCIF file or a design JSON goes through the rigidRNA WebAssembly pipeline (rigidrna_bridge.ts, in a Web Worker, with a log and cancel)
 * and the resulting oxRNA2 .top/.dat load through the viewer's ordinary file path (handleFiles).
 *
 * The Advanced properties section is a table of typed fields (RR_OPTS), like the one of the rigidDNA2 tab: a blank field passes nothing (the engine default
 * applies), an invalid entry is marked and not passed, and the command line preview is made by Rd2RnaApi.buildArgs of wasm/rigidrna/rd2rna_api.js, the very
 * function the worker runs.
 */
let rrEngine = new RnaEngine();
let rrRunning = false;
let spEngine = new SeqpredEngine(); // seqpred: sequence -> secondary structure (wasm/seqpred)
let spRunning = false;
let spLast = null;
let spLastBld2 = null; // result of the last bld2 build (PDB text, oxRNA, instance choices)
let spBld2Running = false;
let spLastModel = null; // the single-chain model the last prediction was asked for (v2/v3/m2)
let spSelIdx = 0; // which ranked candidate the selection panel draws
let spPx = 0; // pixels per nucleotide of the arc diagram (0 = fit)
let spRefPairs = null; // validated reference pairs, or null
let rrFile = null; // the PDB / mmCIF / design file chosen in the file modes
function rrEl(id) { return document.getElementById(id); }
function rrLog(line) {
    const el = rrEl('rrLog');
    if (!el)
        return;
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
}
function rrSetRunning(running) {
    rrRunning = running;
    rrEl('rrRunBtn').disabled = running;
    rrEl('rrCancelBtn').disabled = !running;
}
/** oncreate callback of view.createWindow('rigidDNAWindow', ...) via initRigidDnaHub */
function initRigidRnaWindow() {
    const threads = rrEl('rrThreads');
    const maxT = RnaEngine.maxUsableThreads();
    threads.max = String(Math.max(1, maxT));
    threads.value = String(Math.max(1, Math.min(maxT, 4)));
    threads.disabled = maxT <= 1;
    const cap = RnaEngine.capabilities();
    rrEl('rrEngine').innerHTML = cap.isolated
        ? `Multi-core build available (cross-origin isolated, ${cap.cores} logical cores, up to ${maxT} threads).`
        : `Single-thread build (this page is not cross-origin isolated). <a href="#" onclick="rd2EnableIsolation(); return false;">Enable multi-core via service worker (reloads the page)</a>`;
    rrSaltChanged();
    rrSetRunning(false);
    rrAdvBuild();
    rrModeChanged();
    RnaEngine.loadApi().then(() => rrAdvChanged()).catch(() => rrAdvChanged());
}
/** The input kind chosen in the "Input" select. */
function rrMode() { return (rrEl('rrMode').value || 'db'); }
/** "Input" select: shows the controls of the chosen input kind. */
function rrModeChanged() {
    const m = rrMode();
    const show = (id, on) => { const e = rrEl(id); if (e)
        e.style.display = on ? '' : 'none'; };
    show('rrBlkSeq', m === 'db' || m === 'predict' || m === 'seqpred');
    show('rrBlkDb', m === 'db' || m === 'seqpred');
    show('rrBlkSeqpred', m === 'seqpred');
    show('rrBlkPredict', m === 'predict');
    show('rrBlkFile', m === 'pdb' || m === 'design');
    show('rrBlkPdb', m === 'pdb');
    const file = rrEl('rrFile');
    if (file) {
        file.accept = m === 'pdb' ? '.pdb,.ent,.cif,.mmcif' : '.json';
        file.value = '';
    }
    rrFile = null;
    const lab = rrEl('rrFileLabel');
    if (lab)
        lab.textContent = m === 'pdb' ? 'PDB or mmCIF file (nucleotide frames and Leontis-Westhof base pairs are computed by the engine)' : 'rigidRNA design JSON (sequence, structure or pairs, strands, contacts)';
    const info = rrEl('rrFileInfo');
    if (info)
        info.textContent = 'No file chosen.';
    if (m === 'seqpred') {
        spMethodChanged();
    }
    rrAdvChanged();
}
/** Sets a select by value, through the Metro plugin when it manages the control. Never fires handlers (see spSyncing). */
function spSetSelect(id, v) {
    const s = rrEl(id);
    if (!s || s.value === v)
        return;
    spSyncing = true;
    try {
        s.value = v;
        try {
            window.Metro.getPlugin(s, 'select').val(v);
        }
        catch (e) { /* plain select */ }
    }
    finally {
        spSyncing = false;
    }
}
/** Re-entrancy guard: Metro's select val() fires change synchronously, so the model/method
 *  mirror pair would recurse forever without this. */
let spSyncing = false;
/** Every single-chain RNA model the tab knows (version.models keys of newer builds). */
const SP_SINGLE_MODELS = ['v2', 'v3', 'v4', 'm2', 'h2d', 'ml2', 'ml3', 'nat1', 'e1', 'ml4'];
/** Multi-strand / tool methods of the spMethod select (kept working as before). */
const SP_MULTI_METHODS = ['msrna', 'ms2', 'ms3', 'dna', 'ssdna', 'domainB', 'hybridB', 'auto'];
/** Methods that take several strands separated by & (or one strand): the summary shows strands, molecule and route. */
const SP_STRAND_METHODS = ['msrna', 'ms2', 'ms3'];
/** Methods whose input keeps T (DNA) instead of reading it as U. */
const SP_KEEP_T = ['ms3', 'domainB', 'hybridB', 'auto'];
const SP_TOOL_METHODS = ['nested', 'rna_kl', 'kl_routes', 'longrange', 'domainB', 'hybridB'];
/** One honest line per model, shown under the selector. Taken from the pre-registered sealed test
 *  of the project (44 natural pseudoknot RNAs, 150+150 RNAs without pseudoknot, 46 designed RNAs,
 *  100 shuffled sequences); each quoted number is from that test. The module's own tradeoff wins
 *  when the loaded build carries one (version.models[id].tradeoff). */
const SP_TRADEOFFS = {
    v2: 'Strong on designed kissing RNAs (held-out designed kissing-F1 0.956); on natural RNAs it returns the nested fold (0 of 44 natural pseudoknots found).',
    v3: 'v2 plus closing-helix candidates; same behaviour as v2 on natural RNAs; no held-out result of its own.',
    v4: 'Designed-RNA pair F1 equal to v2 (0.9706 vs 0.9706 on 46 designed RNAs), nested-like on natural and shuffled RNAs (a different structure from the nested fold on 5 of 44 natural pseudoknot RNAs, 1 of 150 other natural RNAs); reports a confidence status.',
    m2: 'More natural pseudoknots found (3 of 44 vs 0 for v2) but many false helices on RNAs without a pseudoknot (8 % of 150 natural RNAs, 21 % of shuffled sequences).',
    h2d: '3 of 44 natural pseudoknots found vs 0 for v2; false helices on 4.7 % of 150 natural RNAs and 11 % of shuffled sequences.',
    ml2: 'Re-ranker, do-no-harm: false helices stay rare but the natural pseudoknot gain was NOT demonstrated on the sealed test.',
    ml3: 'Re-ranker, do-no-harm (false helices on 1.3 % of 150 natural RNAs, 2.0 % of shuffles) but the natural pseudoknot gain was NOT demonstrated on the sealed test (1 of 44 vs 0 for v2, interval includes 0). Needs the external pKiss program: only in the native command-line build (the browser module does not carry it: the program is GPL-licensed and is not compiled into the module; a model without that input would be a different, unevaluated model).',
    ms2: 'Multi-strand RNA / DNA: on 200 DNA complexes F1 0.726 vs 0.720 for the shipped DNA predictor (not distinguishable, +/- 0.03).',
    msrna: 'MS-RNA v4 (multi-strand): the answer to a kissing-complex versus extended-duplex question is a set of states; on blind entries only marginally better than plain ViennaRNA co-folding.',
    dna: 'DNA hybrid (domain pairing + ViennaRNA-DNA MFE): short stems are mostly right, junctions and kissing complexes are not; no NUPACK (proprietary).',
    ssdna: 'Single-stranded DNA tools (hybrid, MFE, G-quadruplex / i-motif rules): the G-quadruplex rule predicts the motif, not its topology.',
    nested: 'Nested Turner 2004 MFE only (salt corrected): no kissing / pseudoknot layer.',
    nat1: 'Natural-RNA pseudoknot model (12-250 nt, fitted at 0.25 M): one blind look, 24 of 228 natural pseudoknots found vs 0 for the nested MFE, false helices 0 / 287 and 1 / 98 shuffles. ML3 finds more (46 of 228) but needs pKiss (native only). Not a designed-RNA model: use v4 (V3D) or MS-3.',
    e1: 'NAT-1 price refitted on a pre-filtered pool (K = 30, or 50): the cheapest form that keeps NAT-1 accuracy, NOT a more accurate energy. Blind look: K = 30 finds 26 of 228 natural pseudoknots, 1 / 287 and 1 / 98 false helices. 12-250 nt.',
    ml4: 'HG-Net ensemble on the NAT-1 price: does not beat NAT-1 at equal false-helix cost (blind look: 29 of 228 natural pseudoknots, 1 / 287 and 1 / 98 false helices). 12-250 nt. Not a designed-RNA model.',
    ms3: 'EXPERIMENTAL. One strand: design signature gate (designed ssDNA / ssRNA origami: domain pairing + MFE, a DESIGN DECODER, not blind) else MFE with G4 protection and a stem filter; several strands: MS-2 unchanged; assembly summary (contacts, complexes, dimer dG). Held-out second look on 12 designs only.',
    domainB: 'Domain pairing B: longest complementary segments first, no thermodynamics. A DESIGN DECODER for designed RNA / DNA and ssRNA-origami sequences, not a blind folding model.',
    hybridB: 'Domain pairing B plus the MFE pairs with both ends free (stems >= 3). A DESIGN DECODER: good only on designed sequences, not a blind folding model.',
    auto: 'Recommended. The router of lane ROUTE-1 (rule R1): one frozen model per input, and the result says which model answered and why. Natural RNA of 12-500 nt: ML3 in the native tool, but ML3 needs the GPL-3 pKiss program and is NOT in the browser, so here the answer comes from NAT-1 (12-250 nt) or the nested MFE (the result is flagged ML3 unavailable). Designed kissing-loop RNA: V3D; long designed strands: MS-3; several RNA strands: MS-2; DNA: MS-3. Runs V3D first on every single RNA, so it is slower than NAT-1 alone.',
};
/** Models the tab flags EXPERIMENTAL (shown as a badge; the module's own status wins when present). */
const SP_EXPERIMENTAL = ['m2', 'h2d', 'ml2', 'ml3', 'ms3'];
/** Which option block each single-chain model uses (salt and time budget: all; threads: all but ms2). */
function spModelOptions(id) {
    if (id === 'm2' || id === 'h2d')
        return ['gateMargin'];
    if (id === 'ml2' || id === 'ml3')
        return ['thr'];
    if (id === 'e1')
        return ['k'];
    return [];
}
/** The single-chain model select follows the method select (v2/v3/...); other methods hide it. */
function spMethodChanged() {
    if (spSyncing)
        return;
    const m = rrEl('spMethod').value;
    const row = rrEl('spModelRow');
    if (row)
        row.style.display = SP_SINGLE_MODELS.indexOf(m) >= 0 ? '' : 'none';
    if (SP_SINGLE_MODELS.indexOf(m) >= 0)
        spSetSelect('spModel', m);
    spRefreshModel();
}
/** The model select drives the method select (models missing from the build stay disabled). */
function spModelChanged() {
    if (spSyncing)
        return;
    // the model row is hidden unless a single-chain method is selected: a (delayed) change event of the hidden select (Metro refresh) must not override auto / ms2 / ...
    if (SP_SINGLE_MODELS.indexOf(rrEl('spMethod').value) < 0)
        return;
    const v = rrEl('spModel').value;
    if (SP_SINGLE_MODELS.indexOf(v) >= 0)
        spSetSelect('spMethod', v);
    spRefreshModel();
}
/** Trade-off text of a model or method: the module's own line wins, else the honest fallback above. */
function spTradeoff(id, info) {
    if (info && typeof info.tradeoff === 'string' && info.tradeoff)
        return info.tradeoff;
    if (info && typeof info.note === 'string' && info.note)
        return info.note;
    return SP_TRADEOFFS[id] || '';
}
/** Short label of a model or method for the selector (module label wins). */
function spLabel(id, info, fallback) {
    if (info && typeof info.label === 'string' && info.label)
        return info.label;
    return fallback;
}
/** Shows or hides the per-model option blocks for the current selection. */
function spShowOptionsFor(sel) {
    const show = (id, on) => { const e = rrEl(id); if (e)
        e.style.display = on ? '' : 'none'; };
    const single = SP_SINGLE_MODELS.indexOf(sel) >= 0;
    const multi = sel === 'ms2' || sel === 'msrna' || sel === 'ms3' || sel === 'auto';
    show('spGateRow', single && spModelOptions(sel).indexOf('gateMargin') >= 0);
    show('spThrRow', single && spModelOptions(sel).indexOf('thr') >= 0);
    show('spMsRow', multi);
    show('spKRow', single && spModelOptions(sel).indexOf('k') >= 0);
    show('spMs2Only', sel === 'ms2' || sel === 'msrna'); // auto: molecule and temperature only
    show('spMs3Row', sel === 'ms3');
    const gate = rrEl('spGate');
    if (gate && (sel === 'm2' || sel === 'h2d'))
        gate.placeholder = sel === 'h2d' ? 'default 4' : 'default 2';
}
/** Generation counter: rapid selection changes start overlapping refreshes; only the latest may write. */
let spRefreshGen = 0;
/** Rebuilds the model selector from the loaded module's version.models: every model the build
 *  offers is selectable, models missing from the build are disabled ("not in this build"). */
async function spRefreshModel() {
    const gen = ++spRefreshGen;
    const s = document.getElementById('spModel');
    if (!s)
        return;
    let v = null;
    try {
        v = await spEngine.versionInfo();
    }
    catch (e) {
        v = null;
    }
    if (gen !== spRefreshGen)
        return; // a newer selection won: do not overwrite its line
    const mm = (v && v.models) || {};
    const fallbacks = {
        v2: 'v2 (default, validated on designed RNAs)', v3: 'v3 (closing-helix candidates; frozen, no held-out result)',
        v4: 'v4 (short-helix rule + confidence)', m2: 'M2 (experimental re-ranker)', h2d: 'h2d (2D refit, experimental)',
        ml2: 'ml2 (re-ranker)', ml3: 'ml3 (re-ranker, needs pKiss)', nat1: 'NAT-1 (natural RNA, topology price + gate)', e1: 'ENERGY-1 (NAT-1 price, pre-filtered pool)', ml4: 'ML-4 (HG-Net ensemble on the NAT-1 price)',
    };
    for (const o of Array.from(s.options)) {
        const id = o.value;
        const info = mm[id];
        const ok = SeqpredEngine.modelSupported(v, id);
        const exp = (info && /experimental/i.test(String(info.status || ''))) || SP_EXPERIMENTAL.indexOf(id) >= 0;
        o.disabled = !ok;
        o.text = spLabel(id, info, fallbacks[id] || id)
            + (exp ? ' [EXPERIMENTAL]' : '')
            + (ok ? '' : ' \u2014 not in this build');
        o.title = spTradeoff(id, info);
    }
    // The method select mirrors availability for the single-chain entries (same ids as methods).
    const sm = document.getElementById('spMethod');
    if (sm)
        for (const o of Array.from(sm.options)) {
            const id = o.value;
            if (SP_SINGLE_MODELS.indexOf(id) < 0 && id !== 'ms2' && id !== 'ms3' && id !== 'domainB' && id !== 'hybridB' && id !== 'auto')
                continue;
            const ok = SeqpredEngine.modelSupported(v, id);
            o.disabled = !ok;
            if (ok)
                o.text = o.text.replace(/\s*\u2014\s*not in this build\s*$/, '');
            if (!ok && (SP_SINGLE_MODELS.indexOf(id) >= 0 || id === 'ms2' || id === 'ms3' || id === 'domainB' || id === 'hybridB' || id === 'auto') && o.text.indexOf('not in this build') < 0)
                o.text += ' \u2014 not in this build';
        }
    if (!SeqpredEngine.modelSupported(v, s.value))
        spSetSelect('spModel', 'v2');
    if (sm && sm.value === 'auto' && !SeqpredEngine.modelSupported(v, 'auto'))
        spSetSelect('spMethod', 'v2'); // a build without the router: back to v2
    spSyncing = true;
    try {
        window.Metro.getPlugin(s, 'select').val(s.value);
    }
    catch (e) { /* plain select */ }
    finally {
        spSyncing = false;
    }
    // One honest line under the selector (+ badges), and the option blocks for this selection.
    // For a single-chain method the model select mirrors it; otherwise the line describes the method.
    const meth = rrEl('spMethod').value;
    const descId = meth;
    const info = mm[descId];
    const ok = (SP_SINGLE_MODELS.indexOf(descId) >= 0 || descId === 'ms2' || descId === 'ms3' || descId === 'domainB' || descId === 'hybridB' || descId === 'auto') ? SeqpredEngine.modelSupported(v, descId) : true;
    const trade = rrEl('spTradeoff');
    if (trade) {
        const exp = (info && /experimental/i.test(String(info.status || ''))) || SP_EXPERIMENTAL.indexOf(descId) >= 0;
        trade.innerHTML = ''
            + (exp && ok ? '<span class="sp-badge sp-exp">EXPERIMENTAL</span> ' : '')
            + (!ok ? '<span class="sp-badge sp-missing">' + 'not in this build' + '</span> ' : '')
            + '<span>' + spTradeoff(descId, info).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</span>';
    }
    spShowOptionsFor(meth);
}
/** Reads the chosen file of the PDB / design modes. */
async function rrFileChosen(input) {
    const f = input.files && input.files[0];
    if (!f) {
        rrFile = null;
        rrEl('rrFileInfo').textContent = 'No file chosen.';
        rrAdvChanged();
        return;
    }
    try {
        const text = await f.text();
        rrFile = { name: f.name, text };
        const atoms = rrMode() === 'pdb' ? (text.match(/^(ATOM|HETATM)/gm) || []).length || (text.match(/^(ATOM|HETATM)\s/gm) || []).length : 0;
        rrEl('rrFileInfo').textContent = `${f.name}: ${(text.length / 1024).toFixed(1)} kB` + (atoms ? `, ${atoms} atom records` : '') + '.';
    }
    catch (e) {
        rrFile = null;
        rrEl('rrFileInfo').textContent = 'Could not read ' + f.name + '.';
    }
    rrAdvChanged();
}
/** "Load example" button: a dumbbell of two 7 bp hairpins joined by a 4 nt linker (a minimal two-stem design). */
function rrExample() {
    rrEl('rrSeq').value = 'GGGCGCGAAAACGCGCCCAAAAGGGCGCGAAAACGCGCCC';
    rrEl('rrDb').value = '(((((((....)))))))....(((((((....)))))))';
    rrAdvChanged();
}
/** Shows the Debye length of the chosen salt (oxRNA2: 0.3667 * sqrt(T/300 K) / sqrt(I) oxRNA units of 0.8518 nm). */
function rrSaltChanged() {
    const salt = parseFloat(rrEl('rrSalt').value), temp = parseFloat(rrEl('rrTemp').value) || 300;
    const el = rrEl('rrDebye');
    if (!(salt > 0)) {
        el.textContent = '';
        return;
    }
    el.textContent = `Debye length ${(0.3667258 * Math.sqrt(temp / 300) / Math.sqrt(salt) * 0.8518).toFixed(2)} nm`;
}
const RR_GROUPS = ['Helix model and relaxation', 'De novo layout (sequence + dot-bracket, design JSON, --layout)', 'Electrostatics, checks and constraints', 'Further options'];
function rrOpt(group, id, flag, key, kind, label, def, help, more) {
    return Object.assign({ id, flag, group: RR_GROUPS[group], kind, label, def, help }, key ? { key } : {}, more || {});
}
const RR_OPTS = [
    rrOpt(0, 'minStem', '--min-stem', 'minStem', 'int', 'Shortest modelled stem (bp)', '2', 'helices shorter than this are not modelled as rigid base-pair nodes (they become an isolated-pair flag and a trap)', { min: 1, max: 50, step: 1 }),
    rrOpt(0, 'noGu', '--no-gu', 'noGu', 'check', 'No G-U pairs', '', 'do not model G-U pairs'),
    rrOpt(0, 'dmin', '--dmin', 'dmin', 'num', 'Helix repulsion distance', '2.8', 'helix-axis repulsion distance (oxRNA length units). Raising it was tested on RNA and did not help (docs/55 of the engine repository)', { min: 0.1, max: 20, step: 0.1 }),
    rrOpt(0, 'krep', '--krep', 'krep', 'num', 'Repulsion stiffness', '5', 'stiffness of the helix-axis repulsion', { min: 0, max: 100000, step: 1 }),
    rrOpt(0, 'noRelax', '--no-relax', 'noRelax', 'check', 'No relaxation', '', 'export the start poses without Levenberg-Marquardt', { wide: true }),
    rrOpt(1, 'noRodnet', '--no-rodnet', 'noRodnet', 'check', 'No rod network', '', 'de novo layout without the global rod-network optimisation (docs RNA-15): the older greedy placement'),
    rrOpt(1, 'noEmbed', '--no-embed', 'noEmbed', 'check', 'No graph embedding', '', 'de novo layout without the graph-embedding start of the rod network (docs RNA-15 section 4b)'),
    rrOpt(1, 'noCompact', '--no-compact', 'noCompact', 'check', 'No compaction', '', 'de novo layout without the compaction of the rod network towards the Rg law (docs RNA-21)'),
    rrOpt(1, 'compactKc', '--compact-kc', null, 'num', 'Compaction strength', '0.1', 'strength of the pull per stem towards the target Rg (energy kc * S * dRg^2, docs RNA-21)', { min: 0, max: 1000 }),
    rrOpt(1, 'compactScale', '--compact-scale', null, 'num', 'Compaction target scale', '1.0', 'multiplies the target Rg. 1.1 lowers the close pairs of the 3,000-5,000 nt cages but made one RNA origami worse (docs RNA-21)', { min: 0.1, max: 10 }),
    rrOpt(1, 'compactDmin', '--compact-dmin', null, 'num', 'Rod distance while compacting', 'rod distance', 'rod-rod distance used while compacting and afterwards (0 = the rod distance); 3.0 / 3.4 had no systematic effect (docs RNA-21)', { min: 0, max: 20 }),
    rrOpt(1, 'embedReach', '--embed-reach', null, 'num', 'Embedding edge reach', '0.6', 'edge length of the stem graph = anchor-to-centre distances of both stems plus this fraction of the cable reach (docs RNA-15)', { min: 0, max: 10 }),
    rrOpt(1, 'noSeedUnpaired', '--no-seed-unpaired', 'noSeedUnpaired', 'check', 'Rebuild unpaired nucleotides (PDB)', '', 'with a PDB start: rebuild the nucleotides outside the rigid base-pair nodes with the loop builder instead of taking the input frames (docs RNA-17)', { wide: true }),
    rrOpt(2, 'elecScale', '--elec-scale', 'elecScale', 'num', 'Electrostatic strength', '1.0', 'multiplies the oxRNA2 charge strength (only with Electrostatics ticked)', { min: 0, max: 100 }),
    rrOpt(2, 'foldCheck', '--fold-check', 'foldCheck', 'check', 'Check stems against the ensemble', '', 'for a given structure: ensemble probability of every modelled stem (McCaskill); stems below 0.2 are flagged weak_in_ensemble'),
    rrOpt(2, 'toehold', '--toehold', 'toehold', 'ranges', 'Single-stranded toeholds', '', 'nucleotides A..B (0-based, as A-B, comma separated list) kept single stranded and extended', { wide: true }),
    rrOpt(2, 'noSsRepair', '--no-ss-repair', null, 'check', 'No single-strand repair', '', 'skip the repair pass of the single-stranded runs of the export (as rd2_export)'),
    rrOpt(2, 'noGlobalRepair', '--no-global-repair', null, 'check', 'No global repair', '', 'skip the global close-pair repair of the export (as rd2_export, docs RNA-22)'),
    rrOpt(3, 'verbatim', '', null, 'text', 'Other rd2_rna options (verbatim)', '', 'further switches exactly as on the command line, e.g. --compact-max-flat 0.3 --compact-shell 0.2; every word is passed as typed. File-path options do not work in the browser', { wide: true }),
];
/** rd2_rna options that exist but cannot be set from this tab, with the reason. */
const RR_NATIVE_ONLY = [
    ['--keep-open A-B, --base-flip I[:DIST], --back-flip END:TARGET[:R0[:RATE]], --hold I:J[:R0]', 'write external-force entries for the oxRNA2 molecular dynamics (force files); the tab loads the .top and .dat only'],
    ['--constraint C', 'folding constraint of the predictor; its notation is documented in the engine (apps/rd2_fold.cpp), not exposed here'],
    ['--write-pdb', 'writes an approximate all-atom PDB next to the result; the worker returns the .top and .dat only'],
    ['--conf TOP DAT --pairs F', 'oxRNA configuration as start: choose a PDB file, or a design JSON, instead'],
    ['--params F, --template F, --out PREFIX', 'file paths: the parameter set and the template are embedded in the WebAssembly module'],
];
function rrAdvId(o, part) { return 'rra_' + o.id + (part ? '_' + part : ''); }
function rrAdvInput(id) { return document.getElementById(id); }
/** Builds the Advanced properties groups (in #rrAdvHost) from the table. Called once, when the window is created. */
function rrAdvBuild() {
    const host = document.getElementById('rrAdvHost');
    if (!host || host.childElementCount)
        return;
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls)
        e.className = cls; if (text !== undefined)
        e.textContent = text; return e; };
    const acc = mk('div', 'accordion');
    acc.setAttribute('data-role', 'accordion');
    acc.setAttribute('data-one-frame', 'false');
    for (const g of RR_GROUPS) {
        const frame = mk('div', 'frame');
        const heading = mk('div', 'heading', g);
        const content = mk('div', 'content');
        const row = mk('div', 'row');
        for (const o of RR_OPTS.filter(x => x.group === g)) {
            const cell = mk('div', o.wide ? 'cell-12' : 'cell-6');
            cell.title = `${o.flag}${o.def ? ' (default: ' + o.def + ')' : ''}: ${o.help}`;
            if (o.kind === 'check') {
                const l = mk('label', 'checkbox');
                const inp = mk('input');
                inp.type = 'checkbox';
                inp.id = rrAdvId(o);
                l.appendChild(inp);
                l.appendChild(mk('span', 'check'));
                l.appendChild(mk('span', 'caption', `${o.label} (${o.flag})`));
                cell.appendChild(l);
            }
            else {
                const lab = mk('label');
                lab.appendChild(document.createTextNode(o.label + ' '));
                if (o.flag)
                    lab.appendChild(mk('code', 'text-small', o.flag));
                cell.appendChild(lab);
                const inp = mk('input');
                inp.id = rrAdvId(o);
                if (o.kind === 'int' || o.kind === 'num') {
                    inp.type = 'number';
                    inp.min = String(o.min);
                    inp.max = String(o.max);
                    inp.step = o.kind === 'int' ? '1' : 'any';
                }
                else
                    inp.type = 'text';
                inp.placeholder = o.kind === 'ranges' ? 'e.g. 0-3, 20-25' : (o.def ? 'default ' + o.def : '');
                cell.appendChild(inp);
            }
            const hint = mk('div', 'rd2-hint');
            hint.id = rrAdvId(o, 'hint');
            cell.appendChild(hint);
            row.appendChild(cell);
        }
        content.appendChild(row);
        frame.appendChild(heading);
        frame.appendChild(content);
        acc.appendChild(frame);
    }
    host.appendChild(acc);
    const nat = mk('div', 'mt-2');
    nat.appendChild(mk('h5', undefined, 'Native rd2_rna only (not available in the browser)'));
    for (const [flag, why] of RR_NATIVE_ONLY) {
        const item = mk('div', 'rd2-native text-small');
        item.appendChild(mk('code', undefined, flag));
        item.appendChild(document.createTextNode(' ' + why));
        nat.appendChild(item);
    }
    host.appendChild(nat);
    const pane = document.getElementById('rdPane3');
    if (pane && !pane.__rrWired) {
        pane.__rrWired = true;
        pane.addEventListener('input', rrAdvChanged);
        pane.addEventListener('change', rrAdvChanged);
    }
}
/** Reads and checks every advanced field. Nothing invalid reaches the command line. */
function rrAdvRead() {
    const st = { fields: {}, extra: [], problems: [], set: 0 };
    const parseNum = (s, o, integer) => {
        s = s.trim();
        if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s))
            return { err: 'not a number' };
        const v = Number(s);
        if (!isFinite(v))
            return { err: 'not a number' };
        if (integer && !Number.isInteger(v))
            return { err: 'must be a whole number' };
        if (o.min !== undefined && v < o.min)
            return { err: 'must be at least ' + o.min };
        if (o.max !== undefined && v > o.max)
            return { err: 'must be at most ' + o.max };
        return { v };
    };
    for (const o of RR_OPTS) {
        const el = rrAdvInput(rrAdvId(o));
        if (!el)
            continue;
        let value = undefined, flagArgs = null, err = '';
        if (o.kind === 'check') {
            if (el.checked) {
                value = true;
                flagArgs = [o.flag];
            }
        }
        else if (o.kind === 'int' || o.kind === 'num') {
            const t = el.value.trim();
            if (t) {
                const r = parseNum(t, o, o.kind === 'int');
                if (r.err)
                    err = r.err;
                else if ((o.key === 'dmin' || o.key === 'krep' || o.key === 'minStem' || o.key === 'elecScale') && !(r.v > 0))
                    err = 'must be above 0 (a blank field means the default)';
                else {
                    value = r.v;
                    flagArgs = [o.flag, String(r.v)];
                }
            }
        }
        else if (o.kind === 'ranges') {
            const t = el.value.trim();
            if (t) {
                const parts = t.split(/[,;\s]+/).filter(Boolean);
                const bad = parts.find(p => { const m = /^(\d+)-(\d+)$/.exec(p); return !m || Number(m[1]) > Number(m[2]); });
                if (bad)
                    err = `"${bad}" is not a range A-B with A <= B`;
                else {
                    value = parts;
                    flagArgs = parts.flatMap(p => [o.flag, p]);
                }
            }
        }
        else if (o.kind === 'text') {
            const t = el.value.trim();
            if (t) {
                const words = t.split(/\s+/);
                if (!words[0].startsWith('--'))
                    err = 'must start with an option such as --no-gu';
                else if (words.some(w => /^--(out|params|template|seq|db|json|pdb|conf|pairs|predict|threads)$/.test(w)))
                    err = 'inputs, outputs and threads are set by the tab';
                else
                    flagArgs = words;
            }
        }
        const hint = document.getElementById(rrAdvId(o, 'hint'));
        const bad = !!err;
        if (bad)
            st.problems.push({ id: o.id, msg: err });
        if (hint) {
            hint.textContent = bad ? 'Ignored: ' + err + '.' : '';
            hint.classList.toggle('rd2-bad', bad);
        }
        el.classList.toggle('rd2-invalid', bad);
        if (!flagArgs)
            continue;
        st.set++;
        if (o.key)
            st.fields[o.key] = value;
        else
            st.extra.push(...flagArgs);
    }
    return st;
}
/** The options object of the bridge: the basic controls plus the advanced fields. */
function rrOptions() {
    const adv = rrAdvRead();
    const o = {
        salt: parseFloat(rrEl('rrSalt').value) || 0.5,
        temp: parseFloat(rrEl('rrTemp').value) || 300,
        elec: rrEl('rrElec').checked,
        iters: parseInt(rrEl('rrIters').value) || 300,
        threads: parseInt(rrEl('rrThreads').value) || 1,
        ...adv.fields,
    };
    if (adv.extra.length)
        o.extra = adv.extra;
    const m = rrMode();
    if (m === 'predict') {
        const g = parseFloat(rrEl('rrGamma').value), s = parseInt(rrEl('rrMaxSpan').value);
        if (rrEl('rrPredict').value === 'mea' && g > 0)
            o.gamma = g;
        if (s > 0)
            o.maxSpan = s;
    }
    if (m === 'pdb' && rrEl('rrLayout').checked)
        o.layout = true;
    return o;
}
/** The input of the run for the chosen mode, or an error text. */
function rrInput() {
    const m = rrMode();
    if (m === 'db' || m === 'predict' || m === 'seqpred') {
        const seq = rrEl('rrSeq').value.replace(/\s+/g, '').toUpperCase().replace(/T/g, 'U');
        const bases = seq.replace(/[&\/]/g, '');
        if (!bases)
            return { error: 'Enter a sequence.' };
        if (/[^ACGUN&\/]/.test(seq))
            return { error: 'The sequence may contain only A, C, G, U, N (T is read as U) and & or / between strands.' };
        if (m === 'predict')
            return { input: { seq, predict: rrEl('rrPredict').value } };
        const db = rrEl('rrDb').value.replace(/\s+/g, '');
        const structure = db.replace(/[&\/]/g, '');
        if (m === 'seqpred' && !structure)
            return { error: 'Press "Predict structure" first: seqpred writes the predicted dot-bracket here (you can edit it before building).' };
        if (m === 'seqpred' && spLast && (spLast.method === 'dna' || spLast.method === 'ssdna') && rrEl('spMethod').value === spLast.method)
            return { error: 'This is a DNA prediction: the rigidRNA engine builds RNA structures only, so the DNA structure is not built here (its pairs and dot-bracket are shown in the summary).' };
        if (!structure || bases.length !== structure.length)
            return { error: `The sequence (${bases.length} nt) and the dot-bracket (${structure.length} characters) must have the same length.` };
        return { input: { seq, db } };
    }
    if (!rrFile)
        return { error: m === 'pdb' ? 'Choose a PDB or mmCIF file.' : 'Choose a design JSON file.' };
    if (m === 'pdb') {
        const chains = rrEl('rrChains').value.trim(), model = rrEl('rrModel').value.trim();
        if (chains && !/^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/.test(chains))
            return { error: 'Chains: identifiers separated by commas, e.g. A,B.' };
        if (model && !/^(\d+|all)$/i.test(model))
            return { error: 'Model: a number or all.' };
        const input = { pdb: rrFile.text };
        if (chains)
            input.chains = chains.replace(/\s+/g, '');
        if (model)
            input.model = model.toLowerCase();
        return { input };
    }
    try {
        JSON.parse(rrFile.text);
    }
    catch (e) {
        return { error: rrFile.name + ' is not valid JSON.' };
    }
    return { input: { design: rrFile.text } };
}
function rrQuote(a) { return /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'"; }
/** The command line that the run will give to rd2_rna: the option arguments are made by Rd2RnaApi.buildArgs of wasm/rigidrna/rd2rna_api.js, the very function the worker runs. */
function rrCommandLine() {
    const api = window.Rd2RnaApi;
    if (!api)
        return { text: '', error: 'the engine script (rd2rna_api.js) is not loaded yet' };
    try {
        const o = rrOptions();
        o.threads = Math.max(1, Math.min(o.threads || 1, RnaEngine.maxUsableThreads()));
        const m = rrMode();
        const short = (s) => (s.length > 48 ? s.slice(0, 40) + '...(' + s.length + ' nt)' : s);
        const seq = rrEl('rrSeq').value.replace(/\s+/g, '').toUpperCase().replace(/T/g, 'U') || 'SEQUENCE';
        const db = rrEl('rrDb').value.replace(/\s+/g, '') || 'DOT_BRACKET';
        let a;
        if (m === 'db' || m === 'seqpred')
            a = ['--seq', short(seq), '--db', short(db)];
        else if (m === 'predict')
            a = ['--seq', short(seq), '--predict', rrEl('rrPredict').value];
        else if (m === 'pdb') {
            a = ['--pdb', rrFile ? rrFile.name : 'structure.pdb'];
            const chains = rrEl('rrChains').value.trim().replace(/\s+/g, ''), model = rrEl('rrModel').value.trim().toLowerCase();
            if (chains)
                a.push('--pdb-chains', chains);
            if (model)
                a.push('--pdb-model', model);
        }
        else
            a = ['--json', rrFile ? rrFile.name : 'design.json'];
        a.push('--params', 'rna_elements_v1.json', '--template', 'rna_bp_template.json', '--out', 'out', ...api.buildArgs(o));
        return { text: ['rd2_rna', ...a].map(rrQuote).join(' ') };
    }
    catch (e) {
        return { text: '', error: String((e && e.message) || e) };
    }
}
/** Refreshes the hints, the count and the command line preview. */
function rrAdvChanged() {
    const st = rrAdvRead();
    const cmd = rrCommandLine();
    const pre = document.getElementById('rrCmd');
    if (pre)
        pre.textContent = cmd.error ? 'unavailable: ' + cmd.error : cmd.text;
    const cnt = document.getElementById('rrAdvCount');
    if (cnt)
        cnt.textContent = st.set ? `(${st.set} set${st.problems.length ? ', ' + st.problems.length + ' ignored' : ''})` : (st.problems.length ? `(${st.problems.length} ignored)` : '');
    const sum = document.getElementById('rrAdvProblems');
    if (sum)
        sum.textContent = st.problems.length ? `${st.problems.length} entr${st.problems.length === 1 ? 'y is' : 'ies are'} invalid and will not be passed to the engine (marked in red).` : '';
}
/** "Reset advanced" button: every advanced field back to blank (engine default). */
function rrAdvReset() {
    for (const o of RR_OPTS) {
        const el = rrAdvInput(rrAdvId(o));
        if (!el)
            continue;
        if (o.kind === 'check')
            el.checked = false;
        else
            el.value = '';
    }
    rrAdvChanged();
}
/** "Copy" button of the command line preview. */
async function rrCopyCommand() {
    const t = document.getElementById('rrCmd').textContent;
    try {
        await navigator.clipboard.writeText(t);
        notify('Command line copied.');
    }
    catch (e) {
        notify('Could not copy: select the text and copy it by hand.', 'warn');
    }
}
/** "Build and load" button. */
async function rrRun() {
    if (rrRunning)
        return;
    const got = rrInput();
    if (!got.input) {
        notify(got.error, 'alert');
        return;
    }
    rrEl('rrLog').textContent = '';
    rrEl('rrSummary').innerHTML = '';
    const label = rrEl('rrStage');
    rrSetRunning(true);
    const t0 = performance.now();
    try {
        label.textContent = 'Starting the engine...';
        const opts = rrOptions();
        const cmd = rrCommandLine();
        if (cmd.text)
            rrLog('$ ' + cmd.text);
        const r = await rrEngine.run(got.input, opts, (line) => {
            rrLog(line);
            const m = /^\[[\d.]+s\] (.*)$/.exec(line) || /^\s*(stage .*)$/.exec(line);
            if (m)
                label.textContent = m[1].slice(0, 110);
        });
        label.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s (${r.variant === 'mt' ? r.threads + ' threads' : 'single thread'}).`;
        rrShowSummary(r, rrMode());
        if (r.rc !== 0 || !r.top || !r.dat) {
            notify('rigidRNA produced no structure: ' + (r.log.split('\n').filter(l => /error|unknown|cannot|unbalanced|differ/i.test(l)).pop() || 'see the log'), 'alert');
            return;
        }
        const name = rrFile && (rrMode() === 'pdb' || rrMode() === 'design') ? rrFile.name.replace(/\.[^.]+$/, '') : 'rigidRNA';
        handleFiles([new File([r.top], name + '.top'), new File([r.dat], name + '.dat')]);
    }
    catch (e) {
        label.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Failed: ' + e.message;
        if (e.message !== 'cancelled')
            notify('rigidRNA failed: ' + e.message, 'alert');
    }
    finally {
        rrSetRunning(false);
    }
}
/** "Cancel" button: stops the worker. */
function rrCancel() { if (rrRunning)
    rrEngine.cancel(); }
function rrShowSummary(r, mode) {
    const rep = r.report;
    if (!rep)
        return;
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const rel = rep.relaxed || {};
    const f = (x) => (x === undefined ? '-' : x.toPrecision(3));
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    let h = '<table class="table compact row-hover">' +
        row('input', { db: 'sequence + dot-bracket', seqpred: 'sequence + structure predicted by seqpred' + (spLast && spLast.build ? ' (build ' + spLast.build.build + ')' : ''), predict: 'sequence only, structure predicted by the engine', pdb: 'PDB / mmCIF file', design: 'design JSON' }[mode]) +
        row('nucleotides', rep.n_nt);
    if (mode === 'predict') {
        const db = rrPredictedStructure(r);
        if (db)
            h += row('predicted structure', `<span style="font-family: monospace; word-break: break-all;">${esc(db)}</span>`);
    }
    h += row('model energy (oxRNA units, 1 = 10 kT)', `step ${f(rel.step)}, cable ${f(rel.cable)}, repulsion ${f(rel.rep)}${rel.elec !== undefined ? ', electrostatic ' + f(rel.elec) : ''}, total ${f(rel.total)}`);
    if (rep.elec)
        h += row('electrostatics', `oxRNA2 Debye-Hueckel, ${rep.elec.salt} M, Debye length ${(rep.elec.lambda * 0.8518).toFixed(2)} nm, ${rep.elec.site_pairs} charged site pairs`);
    if (rep.substructures)
        h += row('stems / loops', `${rep.substructures.stems} / ${rep.substructures.loops}`);
    const flags = rep.flags || (r.flags && r.flags.flags) || [];
    h += row('flags', `${flags.length}` + (flags.length ? ' (' + Object.entries(flags.reduce((c, x) => (c[x.type || x.kind || 'flag'] = (c[x.type || x.kind || 'flag'] || 0) + 1, c), {})).map(([k, n]) => `${k} ${n}`).join(', ') + ')' : ''));
    h += row('time', `${(rep.seconds || 0).toFixed(1)} s in the engine, ${r.seconds.toFixed(1)} s with I/O`) + '</table>';
    rrEl('rrSummary').innerHTML = h;
}
/** The dot-bracket the predictor chose, from the report or the log of a sequence-only run. */
function rrPredictedStructure(r) {
    const rep = r.report || {};
    for (const k of ['predicted_db', 'predicted_structure', 'db', 'structure'])
        if (typeof rep[k] === 'string' && rep[k])
            return rep[k];
    const m = /^\s*(?:predicted|structure|db)[^\n:=]*[:=]\s*([.()\[\]{}<>A-Za-z&\/]{5,})\s*$/im.exec(r.log || '');
    return m ? m[1] : '';
}
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// seqpred: "Sequence only: predict with seqpred" input. The predicted dot-bracket is written to the dot-bracket field (editable), then "Build and load" is the ordinary
// rigidRNA run. The module runs in its own worker (wasm/seqpred, SeqpredEngine); nothing leaves the browser.
function spOptions() {
    // The method select stays authoritative (old callers set it directly); the model select mirrors
    // it for the single-chain predictor and is passed on as options.model for the gated lanes.
    const method = rrEl('spMethod').value;
    let model = undefined;
    if (SP_SINGLE_MODELS.indexOf(method) >= 0) {
        const v = rrEl('spModel').value;
        model = (SP_SINGLE_MODELS.indexOf(v) >= 0 ? v : method);
    }
    const o = {
        method,
        salt: parseFloat(rrEl('spSalt').value) || 0.25,
        budgetSeconds: Math.max(0, parseFloat(rrEl('spBudget').value) || 0),
    };
    if (method !== 'ms2' && method !== 'ms3')
        o.threads = parseInt(rrEl('rrThreads').value) || 1; // ms2 runs single-threaded
    if (model)
        o.model = model;
    const gateEl = rrEl('spGate');
    if (gateEl && rrEl('spGateRow').style.display !== 'none') {
        const g = parseFloat(gateEl.value);
        if (isFinite(g) && g >= 0)
            o.gateMargin = g;
    }
    const thrEl = rrEl('spThr');
    if (thrEl && rrEl('spThrRow').style.display !== 'none') {
        const t = parseFloat(thrEl.value);
        if (isFinite(t) && t >= 0 && t <= 1)
            o.thr = t;
    }
    const kEl = rrEl('spK');
    if (kEl && rrEl('spKRow').style.display !== 'none')
        o.k = (parseInt(kEl.value) === 50 ? 50 : 30);
    if (method === 'ms3') {
        const mol3 = rrEl('spMolecule');
        if (mol3)
            o.molecule = mol3.value;
        const tp3 = rrEl('spTemp');
        if (tp3 && isFinite(parseFloat(tp3.value)))
            o.temp = parseFloat(tp3.value);
        const mg = rrEl('spMg'), cc = rrEl('spConc');
        if (mg && isFinite(parseFloat(mg.value)) && parseFloat(mg.value) > 0)
            o.mg = parseFloat(mg.value);
        if (cc && isFinite(parseFloat(cc.value)) && parseFloat(cc.value) > 0)
            o.concUM = parseFloat(cc.value);
    }
    if (method === 'auto') {
        const mola = rrEl('spMolecule');
        if (mola)
            o.molecule = mola.value;
        const tpa = rrEl('spTemp');
        if (tpa && isFinite(parseFloat(tpa.value)))
            o.temp = parseFloat(tpa.value);
    }
    if (method === 'ms2' || method === 'msrna') {
        const mol = rrEl('spMolecule');
        if (mol)
            o.molecule = mol.value;
        const tp = rrEl('spTemp');
        if (tp && isFinite(parseFloat(tp.value)))
            o.temp = parseFloat(tp.value);
        const da = rrEl('spDeclared'), kp = rrEl('spKiss'), g4 = rrEl('spG4'), md = rrEl('spMsdna');
        if (da)
            o.declaredAssembly = da.checked;
        if (kp)
            o.kissPrior = kp.checked;
        if (g4)
            o.g4 = g4.checked;
        if (md)
            o.msdna = md.checked;
    }
    return o;
}
/** "Predict structure" button of the seqpred input. */
async function spPredict() {
    if (spRunning)
        return;
    const meth = rrEl('spMethod').value;
    const keepT = SP_KEEP_T.indexOf(meth) >= 0; // ms3, domainB, hybridB: T keeps its meaning (DNA)
    const rawSeq = rrEl('rrSeq').value.replace(/\s+/g, '').toUpperCase();
    const seq = keepT ? rawSeq : rawSeq.replace(/T/g, 'U');
    if (!seq) {
        notify('Enter a sequence.', 'alert');
        return;
    }
    const single = SP_SINGLE_MODELS.indexOf(meth) >= 0;
    const multi = meth === 'msrna' || meth === 'ms2' || meth === 'dna' || keepT;
    if (keepT ? (/[^ACGTU&]/.test(seq) || (/T/.test(seq) && /U/.test(seq) && meth !== 'ms3')) : multi ? /[^ACGU&]/.test(seq) : /[^ACGU]/.test(seq)) {
        notify(meth === 'dna' ? 'The DNA hybrid takes strands of A, C, G, T separated by &.' : multi ? 'MS-RNA and MS2 take strands of A, C, G, U separated by & (T is read as U).' : 'This method takes a single strand of A, C, G, U (T is read as U); choose "MS-RNA", "MS2" or "DNA hybrid" for several strands separated by &.', 'alert');
        return;
    }
    const st = rrEl('spStage');
    spRunning = true;
    rrEl('spRunBtn').disabled = true;
    rrEl('spCancelBtn').disabled = false;
    rrEl('spSummary').innerHTML = '';
    const t0 = performance.now();
    const tick = window.setInterval(() => { st.textContent = `Predicting... ${((performance.now() - t0) / 1000).toFixed(0)} s (one thread: about 30 s for 150 nt, minutes for 400 nt with the long-range search)`; }, 1000);
    try {
        st.textContent = 'Starting seqpred...';
        const opts = spOptions();
        spLastModel = opts.model || (SP_SINGLE_MODELS.indexOf(opts.method) >= 0 ? opts.method : null);
        const r = await spEngine.predict(meth === 'dna' || meth === 'ssdna' ? seq.replace(/U/g, 'T') : seq, opts);
        spLast = r;
        spSelIdx = 0;
        spPx = 0;
        spRefPairs = null;
        const ref = rrEl('spRefDb');
        if (ref)
            ref.value = '';
        const rmsg = rrEl('spRefMsg');
        if (rmsg)
            rmsg.textContent = '';
        rrEl('rrDb').value = r.dotbracket;
        const xHel = spCrossingHelices(r);
        st.textContent = r.method === 'auto'
            ? `Done in ${r.wallSeconds.toFixed(1)} s: auto router chose ${r.arm} (${r.label}); ${r.pairs.length} base pairs${r.mlFallback ? '; ML3 is not available in the browser, so the natural-RNA line fell through' : ''}${r.truncated ? ' (truncated: time budget)' : ''}.`
            : r.method === 'dna' || r.method === 'ssdna'
                ? `Done in ${r.wallSeconds.toFixed(1)} s: ${r.pairs.length} DNA base pairs${r.method === 'dna' ? ' over ' + (r.lengths || []).length + ' strands' : ''} (prediction only: the rigidRNA engine builds RNA).`
                : r.method === 'msrna' || r.method === 'ms2' || r.method === 'ms3' || r.method === 'domainB' || r.method === 'hybridB'
                    ? `Done in ${r.wallSeconds.toFixed(1)} s: ${r.pairs.length} base pairs over ${(r.lengths || []).length} strands, state "${r.primary || r.route || '?'}", ${(r.alternatives || []).length} alternative state(s).`
                    : `Done in ${r.wallSeconds.toFixed(1)} s: ${r.pairs.length} base pairs, ${xHel} kissing / pseudoknot helices${r.truncated ? ' (truncated: time budget)' : ''}.`;
        spShowSummary(r);
        spRenderDownloads(r);
        spRenderBuild3d(r);
        spRenderSel();
        rrAdvChanged();
    }
    catch (e) {
        st.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Failed: ' + e.message;
        if (e.message !== 'cancelled')
            notify('seqpred failed: ' + e.message, 'alert');
    }
    finally {
        window.clearInterval(tick);
        spRunning = false;
        rrEl('spRunBtn').disabled = false;
        rrEl('spCancelBtn').disabled = true;
    }
}
function spCancel() { if (spRunning)
    spEngine.cancel(); }
/** Number of crossing helices: pairs in layers >= 1 grouped into contiguous stacks. */
function spCrossingHelices(r) {
    const ps = (r.pairs || []).map((p, k) => ({ p, l: ((r.layers || [])[k] || 0) }))
        .filter((x) => x.l > 0).sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
    let n = 0, pi = -2, pj = -2;
    for (const x of ps) {
        if (x.p[0] !== pi + 1 || x.p[1] !== pj - 1)
            n++;
        pi = x.p[0];
        pj = x.p[1];
    }
    return n;
}
function spNum(x, d) {
    return (typeof x === 'number' && isFinite(x)) ? x.toFixed(d === undefined ? 2 : d) : '-';
}
/** The gate decision line: kind-specific (margin fired / not met, or p vs thr for the discriminator). */
function spGateText(r) {
    const sel = r.selection, g = sel && sel.gate;
    if (!g)
        return 'gate: not reported by this build';
    const kind = g.kind || (r.method === 'm2' || r.method === 'h2d' ? 'margin'
        : (r.method === 'ml2' || r.method === 'ml3' ? 'discriminator' : 'none'));
    const why = g.reason ? ' (' + g.reason + ')' : '';
    const st = (g.stage1Nested !== undefined || g.stage1Crossing !== undefined)
        ? ` [stage1 nested ${spNum(g.stage1Nested)}, crossing ${spNum(g.stage1Crossing)}]` : '';
    if (kind === 'discriminator')
        return `gate (discriminator): p = ${spNum(g.pCross)} vs thr ${spNum(g.thr)}: ${g.fired ? 'fired' : 'not met'}${why}${st}`;
    if (kind === 'logistic')
        return `gate (logistic): p = ${spNum(g.pOpen, 3)} vs threshold ${spNum(g.thr, 3)}: ${g.fired ? 'open (the best crossing candidate is returned)' : 'closed (the nested MFE is returned)'}, price margin ${spNum(g.marginValue)}${why}`;
    if (kind === 'margin')
        return `gate (margin ${spNum(g.margin)}): ${g.fired ? 'fired' : 'not met'}, margin value ${spNum(g.marginValue)}${why}`;
    return `no gate: the top-scored candidate is returned (${g.fired ? 'it has extra helices' : 'it is nested'})`;
}
/** The confidence status line (colour + margins + per-helix rule list). */
function spConfidenceHtml(r) {
    const c = r.confidence;
    if (!c)
        return 'confidence: not reported by this build (needs a newer module)';
    const col = {
        'designed-kissing': 'green', 'low-confidence': '#b45309', 'nested': '#6b7280',
        'extra-helices': '#2563eb', 'fallback-nested': '#b45309', 'truncated': '#b45309', 'single-state': '#6b7280', 'alternatives': '#2563eb', 'pseudoknot': '#2563eb', 'design-decoder': '#b45309',
    };
    const esc = (s) => String(s).replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]));
    let h = `confidence: <b style="color:${col[c.status] || 'inherit'}">${esc(c.status)}</b>`;
    const bits = [];
    if (c.marginNested !== undefined && c.marginNested !== null)
        bits.push(`margin to nested ${spNum(c.marginNested)}`);
    if (c.marginOther !== undefined && c.marginOther !== null)
        bits.push(`margin other ${spNum(c.marginOther)}`);
    if (c.nExtraHelices !== undefined)
        bits.push(`${c.nExtraHelices} extra ${c.nExtraHelices === 1 ? 'helix' : 'helices'}`);
    if (c.pCross !== undefined && c.pCross !== null)
        bits.push(`p = ${spNum(c.pCross)}`);
    if (c.gateProbability !== undefined && c.gateProbability !== null)
        bits.push(`gate p = ${spNum(c.gateProbability, 3)}, threshold ${spNum(c.threshold, 3)}`);
    if (typeof c.calibrated === 'number' && c.status === 'pseudoknot')
        bits.push(`calibrated P(improves F1 by >= 0.05) = ${spNum(c.calibrated)}`);
    if (c.reason)
        bits.push(esc(c.reason));
    if (bits.length)
        h += ` (${bits.join(', ')})`;
    if (c.helices && c.helices.length)
        h += '<br>extra helices: ' + c.helices.map((x) => `${x.i}-${x.j} (${x.k} bp${x.rules && x.rules.length ? ', rules ' + x.rules.map(esc).join('+') : ', no design rule admits it'}${x.lpc === undefined || x.lpc === null ? '' : ', lpc ' + spNum(x.lpc)}`).join('; ');
    return h;
}
/** Margin of the returned structure to the nested-MFE decoy (positive: the returned structure won by this much). */
function spNestedMargin(r) {
    const c = r.confidence;
    if (c && typeof c.marginNested === 'number')
        return c.marginNested;
    const sel = r.selection;
    if (sel && sel.candidates && typeof r.energy?.score === 'number') {
        const nest = sel.candidates.filter((x) => x.label === 'nested' || x.isNestedMfe || x.bestNested)
            .map((x) => x.score).filter((x) => typeof x === 'number');
        if (nest.length)
            return Math.min(...nest) - r.energy.score;
    }
    return null;
}
/** Builds the download files client-side from the result (Blob + a link). File names <model>_<n>nt.<ext>;
 *  for multi-strand results the FASTA has one record per strand with its dot-bracket line. */
function spDownloadContent(r, kind) {
    const base = `${r.method}_${r.length}nt`;
    if (kind === 'json')
        return {
            filename: base + '.json',
            text: JSON.stringify({
                method: r.method, sequence: r.sequence, length: r.length, salt: r.salt,
                dotbracket: r.dotbracket, pairs: r.pairs, layers: r.layers, helices: r.helices,
                energy: r.energy, confidence: r.confidence || null,
                selection: r.selection ? { route: r.selection.route, scoreName: r.selection.scoreName, gate: r.selection.gate } : null,
                truncated: r.truncated,
                version: r.version && { seqpred: r.version.seqpred, predictor: r.version.predictor, viennarna: r.version.viennarna, git: r.version.git },
            }, null, 1),
        };
    const multi = r.method === 'msrna' || r.method === 'ms2' || r.method === 'dna' || r.method === 'ms3' || r.method === 'domainB' || r.method === 'hybridB' || (r.method === 'auto' && r.nStrands > 1);
    const seqs = multi ? (r.strands && r.strands.length ? r.strands.slice() : String(r.sequence).split('&')) : [String(r.sequence).replace(/&/g, '')];
    const dbs = multi ? String(r.dotbracket).split('&') : [String(r.dotbracket).replace(/&/g, '')];
    if (kind === 'fa')
        return { filename: base + '.fa', text: seqs.map((s, k) => `>strand${k + 1} ${base}\n${s}\n${dbs[k] || ''}`).join('\n') + '\n' };
    return { filename: base + '.dbn', text: `>${base}\n${seqs.join('&')}\n${dbs.join('&')}\n` };
}
/** 3D from the prediction: the fast layout (rigidRNA, the ordinary "Build and load") or bld2 (fragment assembly from a PDB-derived motif library: better loops and junctions). */
const SP_BLD2_LABEL = 'bld2 (BUILD-1): coarse model from a motif library of public PDB RNA chains. On 61 clean experimental RNAs the mean TM-score is 0.31 from the true pairs and 0.28 from predicted pairs, against 0.19 for the fast layout; about 8 of 61 reach TM 0.45 (Boltz-2: 0.34). Pseudoknot and kissing-loop pairs are NOT built (set aside); family-novel 3-way / exterior junctions are mostly wrong; steric clashes are frequent (templated atoms). Not a refined structure.';
function spRenderBuild3d(r) {
    const host = rrEl('spBuild3d');
    if (!host)
        return;
    const single = r.method !== 'dna' && r.method !== 'ssdna' && !(r.nStrands > 1) && !((r.lengths || []).length > 1) && !(r.molecule === 'DNA');
    host.innerHTML = `<div class="group"><b>3D from this prediction:</b> `
        + `<button type="button" class="button mini" id="spBuildFastBtn" onclick="rrRun()" title="rigidRNA (rd2_rna): the ordinary Build and load of the dot-bracket field">fast layout (rigidRNA)</button> `
        + `<button type="button" class="button mini" id="spBuildBld2Btn" onclick="spBuildBld2()" ${single ? '' : 'disabled'} title="${single ? 'bld2: better loops and junctions; loads a 7 MB library on first use' : 'bld2 builds one RNA chain: not for DNA or several strands'}">bld2 (better loops / junctions)</button> `
        + `<span id="spBld2Msg" class="text-small"></span></div>`
        + `<p class="rr-note" id="spBld2Note">${SP_BLD2_LABEL}</p><div id="spBld2Result"></div>`;
    spLastBld2 = null;
}
/** "bld2" button: builds the structure in the dot-bracket field (a predicted or chosen candidate) with the bld2 builder and loads the oxRNA model into the scene. */
async function spBuildBld2() {
    if (spBld2Running || spRunning)
        return;
    const msg = rrEl('spBld2Msg'), out = rrEl('spBld2Result');
    const seq = (spLast && spLast.sequence ? String(spLast.sequence) : rrEl('rrSeq').value).replace(/\s+/g, '').toUpperCase().replace(/T/g, 'U').replace(/&/g, '');
    const db = rrEl('rrDb').value.replace(/\s+/g, '').replace(/&/g, '');
    if (!seq || /[^ACGU]/.test(seq)) {
        notify('bld2 builds A, C, G, U sequences only.', 'alert');
        return;
    }
    if (db.length !== seq.length) {
        notify('The dot-bracket field has ' + db.length + ' characters, the sequence ' + seq.length + ': predict first or fix the dot-bracket.', 'alert');
        return;
    }
    spBld2Running = true;
    const btn = rrEl('spBuildBld2Btn');
    if (btn)
        btn.disabled = true;
    const t0 = performance.now();
    try {
        const res = await spEngine.buildBld2(seq, db, (s) => { if (msg)
            msg.textContent = s; });
        spLastBld2 = res;
        const nGeneric = (res.loops || []).filter((l) => l.generic).length;
        const ox = res.oxrna || {};
        const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        let h = '<table class="table compact row-hover">';
        h += `<tr><td>bld2 model</td><td>${res.length} nt, ${res.nStems} stems, ${(res.loops || []).length} loops, ${res.nPairsNested} nested pairs built; ${res.secondsBuild.toFixed(2)} s build, ${((performance.now() - t0) / 1000).toFixed(1)} s with the library</td></tr>`;
        h += `<tr><td>loop instances</td><td>one library instance per loop (medoid of the best matches); ${nGeneric} loop(s) with more arms than the library holds use a generic arrangement</td></tr>`;
        if (res.nPkStemsUnplaced)
            h += `<tr><td>not built</td><td><b style="color:#b45309">${res.nPkStemsUnplaced} pseudoknot / kissing-loop stem(s)</b> were set aside: bld2 builds the nested structure only</td></tr>`;
        if (ox.top)
            h += `<tr><td>oxRNA</td><td>${ox.n} nt in one strand (old topology order, 3' to 5'); ${(ox.nicksAfter5to3Index || []).length} backbone bond(s) are stretched (templated atoms): an oxRNA relaxation closes them</td></tr>`;
        else
            h += `<tr><td>oxRNA</td><td>not available: ${esc(ox.error || 'no export')}</td></tr>`;
        h += `<tr><td>library</td><td>${esc(res.library.chains)} PDB chains, sha1 ${esc(String(res.library.sha1).slice(0, 12))}; <button class="button mini" onclick="spDownloadBld2('pdb')">PDB</button> <button class="button mini" onclick="spDownloadBld2('json')">instances (.json)</button></td></tr>`;
        h += '</table>';
        if (out)
            out.innerHTML = h;
        if (msg)
            msg.textContent = `bld2 done in ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
        if (ox.top && ox.dat)
            handleFiles([new File([ox.top], 'bld2_' + seq.length + 'nt.top'), new File([ox.dat], 'bld2_' + seq.length + 'nt.dat')]);
        else
            notify('bld2 built the model but the oxRNA export failed: download the PDB.', 'warn');
    }
    catch (e) {
        if (msg)
            msg.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'bld2 failed: ' + e.message;
        if (e.message !== 'cancelled')
            notify('bld2 failed: ' + e.message, 'alert');
    }
    finally {
        spBld2Running = false;
        if (btn)
            btn.disabled = false;
    }
}
function spDownloadBld2(kind) {
    if (!spLastBld2) {
        notify('Build with bld2 first.', 'alert');
        return;
    }
    const text = kind === 'pdb' ? spLastBld2.pdb : JSON.stringify({ sequence: spLastBld2.sequence, loops: spLastBld2.loops, nStems: spLastBld2.nStems, nPkStemsUnplaced: spLastBld2.nPkStemsUnplaced, library: spLastBld2.library }, null, 1);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: kind === 'pdb' ? 'chemical/x-pdb' : 'application/json' }));
    a.download = 'bld2_' + spLastBld2.length + 'nt.' + (kind === 'pdb' ? 'pdb' : 'json');
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
/** "Download" buttons of the seqpred result (filled by spRenderDownloads after a prediction). */
function spDownload(kind) {
    if (!spLast) {
        notify('Predict a structure first.', 'alert');
        return;
    }
    const c = spDownloadContent(spLast, kind);
    const blob = new Blob([c.text], { type: kind === 'json' ? 'application/json' : 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = c.filename;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function spRenderDownloads(r) {
    const host = rrEl('spDownloads');
    if (!host)
        return;
    host.innerHTML = `<div class="group">Download: `
        + `<button type="button" class="button mini" onclick="spDownload('dbn')" title="Dot-bracket file">dot-bracket (.dbn)</button> `
        + `<button type="button" class="button mini" onclick="spDownload('json')" title="Pairs, layers, energy, confidence as JSON">pairs (.json)</button> `
        + `<button type="button" class="button mini" onclick="spDownload('fa')" title="Sequence plus dot-bracket per strand">FASTA (.fa)</button></div>`;
}
/** The summary table of a seqpred result as HTML (pure: also called by the renderer check with a hand-written result). */
function spSummaryHtml(r) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    if (r.method === 'auto') {
        // The router's own rows (arm, reason, ML3 fallback, confidence level, arms tried), then the summary of the arm that answered (the result carries the arm's own blocks).
        const a = r;
        const rc = a.routerConfidence || {};
        const col = { high: 'green', medium: '#2563eb', low: '#b45309', unknown: '#6b7280' };
        let h0 = '<table class="table compact row-hover">';
        h0 += row('auto router', `<b>answered by ${esc(a.arm)}</b>: ${esc(a.armTitle || '')}<br>class: ${esc(a.label)}; reason: ${esc(a.reason)} (rule ${esc(a.ruleVersion || 'R1')})`);
        h0 += row('router confidence', `<b style="color:${col[rc.level] || 'inherit'}">${esc(rc.level || 'unknown')}</b>${typeof rc.score === 'number' ? ' (mean pair F1 ' + rc.score.toFixed(3) + ' of the cell ' + esc(rc.cell) + ', n = ' + esc(rc.n) + ')' : ''}<br><span class="text-small">${esc(rc.basis || '')}</span>`);
        if (a.mlFallback)
            h0 += row('ML3 fallback', '<b style="color:#b45309">mlFallback: true</b>. The rule sends natural RNA of 12-500 nt to ML3, which needs the external pKiss program (GPL-3.0-or-later: not part of this module). In the browser ML3 is unavailable, so the answer comes from the next line of the chain (' + esc(a.arm) + '); the native tool with pKiss answers with ML3. The confidence table was built from ML3 answers, so level "unknown" is expected for NAT-1 / nested answers.');
        h0 += row('arms tried', (a.tried || []).map((t) => `${esc(t.arm)}: ${esc(t.outcome)} (${esc(String(t.why).slice(0, 160))})`).join('<br>'));
        if (a.warnings && a.warnings.length)
            h0 += row('warnings', a.warnings.map(esc).join('<br>'));
        h0 += '</table>';
        const inner = Object.assign({}, r, { method: a.armMethod });
        return h0 + spSummaryHtml(inner);
    }
    const gitShort = r.version && r.version.git ? String(r.version.git).slice(0, 12) : '?';
    const prov = row('provenance', `seqpred ${esc(r.version.seqpred)}, ${esc(r.version.predictor)}, ViennaRNA ${esc(r.version.viennarna)}, build ${r.build ? esc(r.build.build) : '?'} (${r.build ? esc(r.build.engine) : 'build.json not found'})`);
    const total = r.timings && typeof r.timings.total === 'number' ? r.timings.total.toFixed(1) : '-';
    const timeRow = row('time', `engine ${total} s, loading ${(r.loadSeconds || 0).toFixed(1)} s, ${r.wallSeconds.toFixed(1)} s with I/O (${r.variant === 'mt' ? 'threaded' : 'single thread'} build)`);
    const truncRow = r.truncated ? row('truncated', `time budget stopped the run${r.timings && r.timings.truncatedAt ? ' at stage ' + esc(r.timings.truncatedAt) : ''}; the structure is the best candidate found so far`) : '';
    let h = '<table class="table compact row-hover">';
    if (r.method === 'dna' || r.method === 'ssdna') {
        const cnt = (a) => (a ? a.length : 0);
        const dnaR = r;
        h += row('method', r.method === 'dna' ? 'DNA hybrid (docs/59 section 5.1): domain pairing + ViennaRNA-DNA MFE on the nucleotides domain pairing leaves free' : 'single-stranded DNA tools (lane SSDNA-1): hybrid, ViennaRNA-DNA MFE, G-quadruplex / i-motif sequence rules') +
            row('strands', (r.lengths || []).map((n, k) => `${k + 1}: ${n} nt`).join(', ')) +
            row('base pairs (hybrid)', `${r.pairs.length}`) +
            (r.method === 'dna' ? row('domain pairing / MFE stems added', `${cnt(dnaR.bPairs)} pairs from domain pairing, ${cnt(dnaR.keptPairs)} pairs added from the MFE (of ${cnt(dnaR.aPairs)} MFE pairs); MFE energy ${r.energy.mfeA.toFixed(2)} kcal/mol (strand order ${(dnaR.ordering || []).map((x) => x + 1).join('-')})`)
                : row('ViennaRNA-DNA MFE', `${cnt(dnaR.mfePairs)} pairs, ${r.energy.mfe.toFixed(2)} kcal/mol (${r.temp} deg C); domain pairing ${cnt(dnaR.domainPairs)} pairs`) +
                    row('G-quadruplex rule (G3+N1-7)', dnaR.g4.motifs.length ? dnaR.g4.motifs.map((m) => m.map(t => `${t[0]}-${t[1]}`).join(' / ')).join('; ') : 'no motif') +
                    row('i-motif rule (C3+N1-7)', dnaR.imotif.motifs.length ? dnaR.imotif.motifs.map((m) => m.map(t => `${t[0]}-${t[1]}`).join(' / ')).join('; ') : 'no motif')) +
            timeRow + truncRow + prov;
    }
    else if (r.method === 'domainB' || r.method === 'hybridB') {
        const dm = r;
        h += row('method', r.method === 'domainB' ? 'domain pairing B (no thermodynamics; a DESIGN DECODER, not a blind folding model)' : 'hybrid B: domain pairing + MFE pairs with both ends free in stems >= 3 (a DESIGN DECODER, not a blind folding model)') +
            row('strands', (r.lengths || []).map((n, k) => `${k + 1}: ${n} nt`).join(', ')) +
            row('molecule', esc(dm.molecule || '?')) +
            row('base pairs', `${r.pairs.length}` + (dm.domain ? ` (${dm.domain.nB} from domain pairing${dm.domain.nA !== undefined ? `, ${dm.domain.nAKept} added from ${dm.domain.nA} MFE pairs; MFE ${spNum(dm.domain.energyA)} kcal/mol` : ''})` : '')) +
            timeRow + truncRow + prov;
    }
    else if (r.method === 'msrna' || r.method === 'ms2' || r.method === 'ms3') {
        const ms = r;
        h += row('method', r.method === 'ms3' ? 'MS-3 (EXPERIMENTAL): single-strand design gate + stem filter + assembly summary on MS-2 (strands separated by &)' : r.method === 'ms2' ? 'MS2 multi-strand RNA / DNA predictor (strands separated by &)' : 'MS-RNA v4 (multi-strand: ViennaRNA co-fold of strand subsets and orderings, partition into complexes at 100 uM, deterministic kissing layer)') +
            row('strands', (r.lengths || []).map((n, k) => `${k + 1}: ${n} nt`).join(', ')) +
            row('molecule', esc(ms.molecule || (r.method === 'msrna' ? 'RNA' : '?')) + (ms.temp !== undefined ? `, ${ms.temp} deg C` : '')) +
            (ms.route ? row('route', esc(ms.route)) : '') +
            row('primary state', `${esc(r.primary || ms.route || '')}${r.primary === 'kiss' ? ' (every strand has at least 50 nt: monomer folds are kept and linked by kissing helices)' : ''}, free energy ${r.energy.freeEnergy !== undefined ? r.energy.freeEnergy.toFixed(2) : '-'} kcal/mol`) +
            row('base pairs', `${r.pairs.length}, of which ${r.layers.filter(l => l > 0).length} cross the nested structure (kissing / pseudoknot layer)`);
        if (ms.signature)
            h += row('design signature', `${(100 * ms.signature.cover).toFixed(0)} % of the nucleotides in ${ms.signature.nstem} unique complementary domains of >= 8 bp (gate: >= 34 %, >= 10 domains, >= 150 nt): ${ms.design ? '<b>design route</b> (domain pairing + MFE: a DESIGN DECODER, not a blind folding model)' : 'not a designed strand: MFE with the stem filter'}`);
        if (ms.assembly) {
            const as = ms.assembly;
            h += row('assembly', `complexes: ${as.complexes.map((c) => '{' + c.map((x) => x + 1).join(',') + '}').join(' ')}` + (as.unpartneredStrands.length ? `; strands without a partner: ${as.unpartneredStrands.map((x) => x + 1).join(', ')}` : '') +
                (as.contacts.length ? `<br>contacts: ${as.contacts.map((c) => `${c.strands[0] + 1}-${c.strands[1] + 1} (${c.interPairs} pairs)`).join(', ')}` : '') +
                (as.dimers ? `<br>dimers (report, not a gate): ${as.dimers.map((d) => `${d.i + 1}+${d.j + 1}: dG ${d.dGAssoc.toFixed(2)} kcal/mol, ${(100 * d.boundFraction).toFixed(1)} % bound`).join('; ')}` : ''));
        }
        if (ms.g4 && ms.g4.tracts && ms.g4.tracts.length)
            h += row('G-quadruplex tracts', `${ms.g4.tracts.length} protected tract(s)`);
        if (ms.kissPrior && ms.kissPrior.fired !== undefined)
            h += row('kissing prior', `${ms.kissPrior.fired ? 'fired' : 'not fired'} (dF ${spNum(ms.kissPrior.dF)})`);
        const alts = r.alternatives || [];
        if (alts.length) {
            h += row('alternative states', alts.map((a, k) => `<b>${esc(a.name)}</b> (${a.F.toFixed(2)} kcal/mol, ${a.pairs.length} pairs) <button class="button mini" onclick="spUseAlternative(${k})">use this structure</button>`).join('<br>'));
        }
        h += timeRow + truncRow + prov;
    }
    else {
        const mg = spNestedMargin(r);
        h += row('method', `${r.method}, salt ${r.salt} M`) +
            (spLastModel && (SP_SINGLE_MODELS.indexOf(r.method) >= 0 || r.method === 'v2' || r.method === 'v3' || r.method === 'm2') ? row('model', `${spLastModel} (single-chain RNA predictor)${spLastModel !== r.method ? `, engine ran ${r.method}` : ''}, build ${r.build ? esc(r.build.build) : '?'}`) : '') +
            row('nested MFE (Turner 2004, salt corrected)', `${r.energy.nestedMfe.toFixed(2)} kcal/mol`) +
            (r.energy.score !== undefined ? row('predictor score', spNum(r.energy.score) + (r.selection && r.selection.scoreName ? ` (${esc(r.selection.scoreName)})` : '')) : '') +
            row('margin to the nested decoy', mg === null ? 'not reported by this build' : `${spNum(mg)} (positive: the returned structure with extra helices won by this much)`) +
            row('gate', esc(spGateText(r))) +
            (r.nat ? row('price model', `status ${esc(r.nat.status)}, gate p ${spNum(r.nat.gateProbability, 3)} (threshold ${spNum(r.nat.threshold, 3)}), price margin ${spNum(r.nat.margin)}, ${r.nat.nCandidates} crossing candidates${r.nat.prefilterK ? ' (pre-filter K = ' + r.nat.prefilterK + ')' : ''}, shuffle z of the nested MFE ${spNum(r.nat.zmfe)}${r.nat.topology.length ? ', topology ' + r.nat.topology.join('+') : ''}${r.nat.tieAtTop ? ', TIE at the top (ranked by index)' : ''}`) : '') +
            (r.ml4 ? row('HG-Net ensemble', `status ${esc(r.ml4.status)}, gate p ${spNum(r.ml4.gateProbability, 3)} (threshold ${spNum(r.ml4.threshold, 3)}), margin ${spNum(r.ml4.margin)} +- ${spNum(r.ml4.marginSd)} over ${r.ml4.nSeeds} seeds, ${r.ml4.nCandidates} crossing candidates`) : '') +
            row('confidence', spConfidenceHtml(r)) +
            row('kissing / pseudoknot helices', (r.helices.length ? r.helices.map(x => `${x.i}-${x.j} (${x.k} bp)`).join(', ') : 'none: the nested MFE is the answer') + ` (${spCrossingHelices(r)} crossing ${spCrossingHelices(r) === 1 ? 'helix' : 'helices'})`) +
            timeRow + truncRow + prov;
    }
    h += row('version', `seqpred ${esc(r.version.seqpred)}, predictor ${esc(r.version.predictor)}, ViennaRNA ${esc(r.version.viennarna)}, git ${esc(gitShort)}`);
    if (r.notes.length)
        h += row('notes', r.notes.map(esc).join('<br>'));
    h += '</table><p class="rr-note">' + (r.method === 'dna' || r.method === 'ssdna'
        ? 'A prediction, not a measurement (docs/71 and docs/73 of rigidDNA2): short stems and hairpins are mostly right, junctions, ligand-bound aptamers and kissing complexes are not; the G-quadruplex rule predicts the motif, not its topology. This module has no NUPACK (proprietary) and no scaffold-alignment / species-collapse step.'
        : r.method === 'domainB' || r.method === 'hybridB' || r.method === 'ms3'
            ? 'A prediction, not a measurement. Domain pairing / the MS-3 design route DECODE designed sequences (unique complementary domains); they are not blind folding models and say nothing about natural RNA or DNA. MS-3 is EXPERIMENTAL until validated on held-out data (docs/93, docs/94 of rigidDNA2).'
            : r.method === 'nat1' || r.method === 'e1' || r.method === 'ml4'
                ? 'A prediction, not a measurement: a natural-RNA pseudoknot model fitted on 12-250 nt single chains at 0.25 M; the gate stays closed for most RNAs and then the answer is the nested MFE. ML3 (native, needs pKiss) found more natural pseudoknots in the blind look; for designed RNA use v4 (V3D) or MS-3 (docs/86, 89, 90, 91 of rigidDNA2).'
                : r.method === 'msrna' || r.method === 'ms2'
                    ? 'A prediction, not a measurement: the answer to a kissing-complex versus extended-duplex question is a set of states, so the alternative states are listed (docs/73_multistrand.md of rigidDNA2). On blind entries MS-RNA is only marginally better than plain ViennaRNA co-folding.'
                    : r.method === 'v3'
                        ? 'A prediction, not a measurement: v3 adds closing-helix candidates to v2 (docs/74 section 12 of rigidDNA2); it was frozen without a held-out result, so v2 remains the validated predictor. On natural RNAs the kissing layer adds nothing to the nested MFE.'
                        : 'A prediction, not a measurement: on natural RNAs the kissing layer adds nothing to the nested MFE (documented in docs/70_seqpred_cpp.md of rigidDNA2); it targets designed kissing-loop RNAs.') + '</p>';
    return h;
}
function spShowSummary(r) {
    rrEl('spSummary').innerHTML = spSummaryHtml(r);
}
/** msrna: copy an alternative state's dot-bracket into the dot-bracket field. */
function spUseAlternative(k) {
    if (!spLast || !spLast.alternatives || !spLast.alternatives[k])
        return;
    rrEl('rrDb').value = spLast.alternatives[k].dotbracket;
    rrEl('spStage').textContent = `Dot-bracket of the alternative state "${spLast.alternatives[k].name}" loaded; "Build and load" builds this structure.`;
    rrAdvChanged();
}
/** Pairs of a dot-bracket string (1-based like the module, '&' and '/' strand separators skipped). */
function spDbPairs(db) {
    const st = { '(': [], '[': [], '{': [], '<': [] };
    const cl = { ')': '(', ']': '[', '}': '{', '>': '<' };
    const out = [];
    let k = 0;
    for (const c of db) {
        if (c === '&' || c === '/')
            continue;
        k++;
        if (st[c])
            st[c].push(k);
        else if (cl[c]) {
            const o = st[cl[c]].pop();
            if (o !== undefined)
                out.push([o, k]);
        }
    }
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
/** One adapter for the module result: field names live here, nowhere else. */
function spAdapt(r) {
    const anyr = r;
    const rawCands = anyr.candidates || anyr.topCandidates || r.top || [];
    const nestedDotbracket = (r.energy && r.energy.nestedDotbracket) || '';
    const nestedPairs = nestedDotbracket ? spDbPairs(nestedDotbracket) : [];
    const nestedSet = new Set(nestedPairs.map(p => p[0] + ',' + p[1]));
    const candidates = rawCands.slice(0, 20).map((c, i) => {
        if (c.pairs && c.pairs.length) {
            const layers = (c.layers && c.layers.length === c.pairs.length) ? c.layers.slice() : c.pairs.map(() => 0);
            return { rank: c.rank || i + 1, hostSource: c.hostSource || c.source || '', score: c.score, helices: c.helices || [], pairs: c.pairs.slice(), layers };
        }
        // Current build: candidates carry helices + score only. Draw them over the nested pairs
        // (exact when the candidate keeps the selected host structure, an approximation otherwise).
        const pairs = nestedPairs.slice();
        const layers = nestedPairs.map(() => 0);
        for (const h of (c.helices || [])) {
            for (let t = 0; t < h[2]; t++) {
                const a = h[0] + t, b = h[1] - t;
                if (a >= b)
                    break;
                const key = a + ',' + b;
                if (!nestedSet.has(key)) {
                    pairs.push([a, b]);
                    layers.push(1);
                }
            }
        }
        const order = pairs.map((p, k) => k).sort((a, b) => pairs[a][0] - pairs[b][0] || pairs[a][1] - pairs[b][1]);
        return { rank: c.rank || i + 1, hostSource: c.hostSource || c.source || '', score: c.score, helices: c.helices || [], pairs: order.map(k => pairs[k]), layers: order.map(k => layers[k]) };
    });
    return {
        length: r.length, pairs: r.pairs.slice(), layers: r.layers.slice(), candidates,
        selScore: r.energy && r.energy.score,
        nestedMfe: r.energy && r.energy.nestedMfe, nestedDotbracket, nestedPairs,
    };
}
/** Dot-bracket of pairs with layers (0: (), 1: [], 2: {}, 3: <>, then Aa, Bb, ...). */
function spPairsDotbracket(n, pairs, layers) {
    const open = ['(', '[', '{', '<'], close = [')', ']', '}', '>'];
    const db = [];
    for (let i = 0; i < n; i++)
        db.push('.');
    pairs.forEach((p, k) => {
        const l = layers[k] || 0;
        if (l < 4) {
            db[p[0] - 1] = open[l];
            db[p[1] - 1] = close[l];
        }
        else {
            const c = String.fromCharCode(65 + (l - 4) % 26);
            db[p[0] - 1] = c;
            db[p[1] - 1] = c.toLowerCase();
        }
    });
    return db.join('');
}
/** Arc-diagram SVG: the selected structure above the axis, the nested-MFE decoy below it. */
function spArcSvg(a, pairs, layers, refSet) {
    const n = a.length;
    const px = spPx || Math.min(8, Math.max(1.5, 900 / Math.max(1, n)));
    const pad = 24, axis = 130, below = 70;
    const W = Math.ceil(n * px + 2 * pad), H = axis + below + 24;
    const X = (i) => (pad + (i - 1) * px).toFixed(1);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let s = `<svg id="spArc" width="${W}" height="${H}" role="img" aria-label="Arc diagram of the selected candidate">`;
    s += `<line x1="${pad}" y1="${axis}" x2="${(pad + n * px).toFixed(1)}" y2="${axis}" stroke="currentColor" stroke-width="1"/>`;
    const step = n > 1000 ? 100 : n > 200 ? 50 : 10;
    for (let i = 1; i <= n; i += step)
        s += `<text x="${X(i)}" y="${H - 6}" font-size="9" fill="currentColor">${i}</text>`;
    const arc = (p, cls, up) => {
        const x1 = pad + (p[0] - 1) * px, x2 = pad + (p[1] - 1) * px;
        const rx = Math.max(1, (x2 - x1) / 2), ry = Math.min(rx * 0.55 + 6, up ? 110 : 56);
        const y2 = up ? axis - 0.01 : axis + 0.01;
        return `<path class="${cls}" d="M ${x1.toFixed(1)} ${axis} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 ${up ? 1 : 0} ${x2.toFixed(1)} ${y2}" fill="none" stroke-width="1.4" opacity="0.85"><title>${p[0]}-${p[1]}</title></path>`;
    };
    pairs.forEach((p, k) => {
        let cls = (layers[k] || 0) > 0 ? 'sp-x' : 'sp-n';
        if (refSet && !refSet.has(p[0] + ',' + p[1]))
            cls += ' sp-nonref';
        s += arc(p, cls, true);
    });
    a.nestedPairs.forEach(p => { s += arc(p, 'sp-decoy', false); });
    s += `<text x="${pad}" y="16" font-size="10" fill="currentColor">${esc('selected: ' + pairs.length + ' pairs')}</text>`;
    s += `<text x="${pad}" y="${axis + below - 2}" font-size="10" fill="currentColor">${esc('nested-MFE decoy: ' + a.nestedPairs.length + ' pairs')}</text>`;
    return s + '</svg>';
}
/** Redraws the selection panel (arc diagram + ranked candidates); shown for every single-chain model (it reads `selection`). */
function spRenderSel() {
    const host = rrEl('spSel');
    if (!host)
        return;
    if (!spLast || SP_SINGLE_MODELS.indexOf(spLast.method) < 0) {
        host.style.display = 'none';
        return;
    }
    host.style.display = '';
    const gateLine = rrEl('spGateLine');
    if (gateLine)
        gateLine.textContent = spGateText(spLast);
    const a = spAdapt(spLast);
    if (spSelIdx < 0 || spSelIdx >= a.candidates.length)
        spSelIdx = 0;
    const cand = a.candidates[spSelIdx];
    const pairs = cand ? cand.pairs : a.pairs, layers = cand ? cand.layers : a.layers;
    const refSet = spRefPairs ? new Set(spRefPairs.map(p => p[0] + ',' + p[1])) : null;
    rrEl('spArcWrap').innerHTML = spArcSvg(a, pairs, layers, refSet);
    const note = rrEl('spArcNote');
    if (note)
        note.textContent = `${a.length} nt, ${pairs.length} pairs drawn${spPx ? ' (' + spPx.toFixed(1) + ' px/nt)' : ''}${cand && cand !== undefined && a.candidates.length ? '; candidate ' + cand.rank + ' of ' + a.candidates.length : ''}. Scroll sideways to inspect.`;
    // Ranked candidates as horizontal bars (lower score is better); the decoy row carries the MFE on its own scale.
    const cands = a.candidates;
    const scores = cands.map(c => c.score).filter(v => typeof v === 'number');
    const lo = Math.min(...scores), hi = Math.max(...scores);
    let h = '';
    cands.forEach((c, k) => {
        const w = (typeof c.score === 'number' && hi > lo) ? (20 + 80 * (hi - c.score) / (hi - lo)) : 60;
        h += `<div class="sp-cand${k === spSelIdx ? ' spsel' : ''}" data-k="${k}" title="Candidate ${c.rank} (${c.hostSource || 'host?'}), score ${typeof c.score === 'number' ? c.score.toFixed(2) : '?'}: click to draw it">`
            + `<span class="text-small"><b>${k === spSelIdx ? '&#9679; ' : '&#9675; '}#${c.rank} ${c.hostSource || ''}</b> ${typeof c.score === 'number' ? c.score.toFixed(2) : '?'}</span>`
            + `<div class="sp-bar" style="width:${w.toFixed(0)}%;background:#2563eb;opacity:${k === spSelIdx ? 1 : 0.55}"></div>`
            + ` <button type="button" class="button mini" data-use="${k}" title="Write this candidate into the dot-bracket field (then Build and load builds it)">use</button></div>`;
    });
    if (typeof a.nestedMfe === 'number') {
        h += `<div class="sp-cand" title="Nested minimum free energy without any long-range layer (own energy scale, not the candidate score)">`
            + `<span class="text-small"><b>nested-MFE decoy</b> ${a.nestedMfe.toFixed(2)} kcal/mol</span>`
            + `<div class="sp-bar" style="width:100%;background:#9ca3af;opacity:0.6"></div></div>`;
    }
    const box = rrEl('spCand');
    box.innerHTML = h || '<span class="text-small text-muted">No ranked candidates in this result.</span>';
    for (const el of Array.from(box.querySelectorAll('.sp-cand[data-k]'))) {
        el.addEventListener('click', (ev) => {
            const t = ev.target;
            if (t && t.getAttribute && t.getAttribute('data-use') !== null)
                return; // the use button handles itself
            spSelIdx = parseInt(el.getAttribute('data-k'), 10) || 0;
            spRenderSel();
        });
    }
    for (const b of Array.from(box.querySelectorAll('button[data-use]'))) {
        b.addEventListener('click', (ev) => { ev.stopPropagation(); spUseCandidate(parseInt(b.getAttribute('data-use'), 10) || 0); });
    }
}
/** Zoom buttons of the arc diagram. */
function spZoom(f) {
    const a = spLast ? spAdapt(spLast) : null;
    const cur = spPx || (a ? Math.min(8, Math.max(1.5, 900 / Math.max(1, a.length))) : 4);
    spPx = Math.min(12, Math.max(1, cur * f));
    spRenderSel();
}
/** Writes a ranked candidate into the dot-bracket field (the 3D flow then builds it). */
function spUseCandidate(k) {
    if (!spLast)
        return;
    const a = spAdapt(spLast);
    if (k < 0 || k >= a.candidates.length)
        return;
    spSelIdx = k;
    const c = a.candidates[k];
    rrEl('rrDb').value = spPairsDotbracket(a.length, c.pairs, c.layers);
    rrEl('spStage').textContent = `Candidate #${c.rank} (${c.hostSource || 'unknown host'}) in the dot-bracket field; "Build and load" builds this structure.`;
    spRenderSel();
    rrAdvChanged();
}
/** Checks a reference dot-bracket and recolours the arcs (orange = predicted but not in reference). */
/** Reference format of a pasted text: dot-bracket, bpseq (3 columns), ct (>= 6 columns) or a pair list. */
function spDetectRefFormat(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('>') && !l.startsWith('#'));
    const body = lines.join('');
    if (body && !/[0-9]/.test(body) && /[().\[\]{}<>]/.test(body))
        return 'dotbracket';
    const cols = lines.filter((l) => /^\d/.test(l)).map((l) => l.split(/\s+/).length);
    if (cols.length && cols.every((c) => c >= 6))
        return 'ct';
    if (cols.length && cols.every((c) => c === 3))
        return 'bpseq';
    return 'pairs';
}
/** "Apply reference": parses the reference (dot-bracket, pair list, bpseq or ct: C++ loaders of the module), recolours the arcs and scores the drawn candidate with the C++ metrics. */
async function spApplyRef() {
    const msg = rrEl('spRefMsg');
    const tab = rrEl('spRefScore');
    const done = (t, bad) => { if (msg) {
        msg.textContent = t;
        msg.style.color = bad ? '#c62828' : '';
    } if (tab && bad)
        tab.innerHTML = ''; };
    if (!spLast) {
        done('Predict a structure first.', true);
        return;
    }
    const a = spAdapt(spLast);
    const raw = rrEl('spRefDb').value;
    if (!raw.trim()) {
        spRefPairs = null;
        done('', false);
        if (tab)
            tab.innerHTML = '';
        spRenderSel();
        return;
    }
    let fmt = (rrEl('spRefFmt') || { value: 'auto' }).value;
    if (fmt === 'auto')
        fmt = spDetectRefFormat(raw);
    let text = raw;
    if (fmt === 'dotbracket') {
        text = raw.replace(/[-:;_~]/g, '.'); // unpaired marks of other tools
        const flat = raw.replace(/\s+/g, '');
        if (/[^().\[\]{}<>.\-:;_~]/.test(flat)) {
            done('Only the brackets ( ) [ ] { } < >, dots and - : ; _ ~ are supported in a dot-bracket reference.', true);
            return;
        }
        if (flat.length !== a.length) {
            done(`The reference is ${flat.length} nt but the sequence is ${a.length} nt.`, true);
            return;
        }
    }
    const pred = (spSelIdx < a.candidates.length ? a.candidates[spSelIdx].pairs : a.pairs);
    let res;
    try {
        res = await spEngine.score({ reference: { format: fmt, text }, prediction: { pairs: pred }, n: a.length, options: { nested: a.nestedPairs, minHelix: 3 } });
    }
    catch (e) {
        done('Reference not accepted: ' + e.message, true);
        return;
    }
    if (fmt !== 'pairs' && res.reference.n !== a.length) {
        done(`The reference has ${res.reference.n} nt but the sequence has ${a.length} nt.`, true);
        return;
    }
    spRefPairs = res.reference.pairs;
    const sc = res.score;
    done(`${fmt} reference, ${res.reference.nPairs} pairs: pair F1 ${spNum(sc.f1, 3)} (${sc.tp} shared, ${sc.fp} only predicted, ${sc.fn} only in the reference).`, false);
    const f = (x, d = 3) => (x === null || x === undefined) ? 'n/a' : (typeof x === 'number' ? x.toFixed(d) : String(x));
    if (tab)
        tab.innerHTML = '<table class="table compact"><tr><th>metric</th><th>value</th><th>metric</th><th>value</th></tr>'
            + `<tr><td>precision</td><td>${f(sc.precision)}</td><td>recall</td><td>${f(sc.recall)}</td></tr>`
            + `<tr><td>F1</td><td>${f(sc.f1)}</td><td>MCC</td><td>${f(sc.mcc)}</td></tr>`
            + `<tr><td>crossing-pair recall</td><td>${f(sc.cross_recall)}</td><td>crossing-pair precision</td><td>${f(sc.cross_precision)}</td></tr>`
            + `<tr><td>helix recall (&gt;= 3 bp)</td><td>${f(sc.helix_recall)}</td><td>crossing-helix recall</td><td>${f(sc.helix_recall_cross)}</td></tr>`
            + `<tr><td>pseudoknot found (F1 &gt;= 0.8 and crossing recall &gt;= 0.5)</td><td>${f(sc.pk_found, 0)}</td><td>false helix</td><td>${f(sc.false_helix, 0)}</td></tr></table>`
            + `<div class="text-small text-muted">Scored with the C++ metrics of the module (port of scripts/seqpred/runall/metrics.py; pairs 1-based); the drawn candidate is scored, the nested MFE decoy is the \"nested\" input of the false-helix test.</div>`;
    spRenderSel();
}
/** Removes the reference overlay. */
function spClearRef() {
    spRefPairs = null;
    const ref = rrEl('spRefDb');
    if (ref)
        ref.value = '';
    const msg = rrEl('spRefMsg');
    if (msg)
        msg.textContent = '';
    const tab = rrEl('spRefScore');
    if (tab)
        tab.innerHTML = '';
    spRenderSel();
}
