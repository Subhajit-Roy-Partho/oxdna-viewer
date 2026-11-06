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
/** The single-chain model select follows the method select (v2/v3); other methods hide it. */
function spMethodChanged() {
    if (spSyncing)
        return;
    const m = rrEl('spMethod').value;
    const row = rrEl('spModelRow');
    if (row)
        row.style.display = (m === 'v2' || m === 'v3') ? '' : 'none';
    if (m === 'v2' || m === 'v3')
        spSetSelect('spModel', m);
    spRefreshModel();
}
/** The model select drives the method select (M2 is disabled while the build lacks it). */
function spModelChanged() {
    if (spSyncing)
        return;
    const v = rrEl('spModel').value;
    if (v === 'v2' || v === 'v3')
        spSetSelect('spMethod', v);
    else if (v === 'm2') { /* selectable only when the loaded build carries M2 (spRefreshModel); passed on as options.model */ }
}
/** Enables the M2 option only when the loaded module build carries it (else it stays disabled). */
async function spRefreshModel() {
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
    const ok = SeqpredEngine.m2Supported(v);
    for (const o of Array.from(s.options)) {
        if (o.value !== 'm2')
            continue;
        o.disabled = !ok;
        o.text = ok ? 'M2 (experimental re-ranker; better on natural pseudoknots, more false helices on random sequences)'
            : 'M2 (experimental re-ranker; better on natural pseudoknots, more false helices on random sequences) \u2014 not in this build';
    }
    spSyncing = true;
    try {
        window.Metro.getPlugin(s, 'select').val(s.value);
    }
    catch (e) { /* plain select */ }
    finally {
        spSyncing = false;
    }
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
    // it for the single-chain predictor and is passed on as options.model for the M2 lane.
    const method = rrEl('spMethod').value;
    let model = undefined;
    if (method === 'v2' || method === 'v3') {
        const v = rrEl('spModel').value;
        model = (v === 'v2' || v === 'v3' || v === 'm2') ? v : method;
    }
    const o = {
        method,
        salt: parseFloat(rrEl('spSalt').value) || 0.25,
        budgetSeconds: Math.max(0, parseFloat(rrEl('spBudget').value) || 0),
        threads: parseInt(rrEl('rrThreads').value) || 1,
    };
    if (model)
        o.model = model;
    return o;
}
/** "Predict structure" button of the seqpred input. */
async function spPredict() {
    if (spRunning)
        return;
    const seq = rrEl('rrSeq').value.replace(/\s+/g, '').toUpperCase().replace(/T/g, 'U');
    if (!seq) {
        notify('Enter a sequence.', 'alert');
        return;
    }
    const meth = rrEl('spMethod').value;
    const multi = meth === 'msrna' || meth === 'dna';
    if (multi ? /[^ACGU&]/.test(seq) : /[^ACGU]/.test(seq)) {
        notify(meth === 'dna' ? 'The DNA hybrid takes strands of A, C, G, T separated by &.' : multi ? 'MS-RNA takes strands of A, C, G, U separated by & (T is read as U).' : 'This method takes a single strand of A, C, G, U (T is read as U); choose "MS-RNA" or "DNA hybrid" for several strands separated by &.', 'alert');
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
        spLastModel = opts.model || (opts.method === 'v3' ? 'v3' : opts.method === 'v2' ? 'v2' : null);
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
        st.textContent = r.method === 'dna' || r.method === 'ssdna'
            ? `Done in ${r.wallSeconds.toFixed(1)} s: ${r.pairs.length} DNA base pairs${r.method === 'dna' ? ' over ' + (r.lengths || []).length + ' strands' : ''} (prediction only: the rigidRNA engine builds RNA).`
            : r.method === 'msrna'
                ? `Done in ${r.wallSeconds.toFixed(1)} s: ${r.pairs.length} base pairs over ${(r.lengths || []).length} strands, primary state "${r.primary}", ${(r.alternatives || []).length} alternative state(s).`
                : `Done in ${r.wallSeconds.toFixed(1)} s: ${r.pairs.length} base pairs, ${r.helices.length} kissing / pseudoknot helices.`;
        spShowSummary(r);
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
function spShowSummary(r) {
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const prov = row('provenance', `seqpred ${esc(r.version.seqpred)}, ${esc(r.version.predictor)}, ViennaRNA ${esc(r.version.viennarna)}, build ${r.build ? esc(r.build.build) : '?'} (${r.build ? esc(r.build.engine) : 'build.json not found'})`);
    const timeRow = row('time', `${r.timings.total.toFixed(1)} s in the engine, ${r.wallSeconds.toFixed(1)} s with loading (${r.variant === 'mt' ? 'threaded' : 'single thread'} build)`);
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
            timeRow + prov;
    }
    else if (r.method === 'msrna') {
        h += row('method', 'MS-RNA v4 (multi-strand: ViennaRNA co-fold of strand subsets and orderings, partition into complexes at 100 uM, deterministic kissing layer)') +
            row('strands', (r.lengths || []).map((n, k) => `${k + 1}: ${n} nt`).join(', ')) +
            row('primary state', `${esc(r.primary || '')}${r.primary === 'kiss' ? ' (every strand has at least 50 nt: monomer folds are kept and linked by kissing helices)' : ''}, free energy ${r.energy.freeEnergy.toFixed(2)} kcal/mol`) +
            row('base pairs', `${r.pairs.length}, of which ${r.layers.filter(l => l > 0).length} cross the nested structure (kissing / pseudoknot layer)`);
        const alts = r.alternatives || [];
        if (alts.length) {
            h += row('alternative states', alts.map((a, k) => `<b>${esc(a.name)}</b> (${a.F.toFixed(2)} kcal/mol, ${a.pairs.length} pairs) <button class="button mini" onclick="spUseAlternative(${k})">use this structure</button>`).join('<br>'));
        }
        h += timeRow + prov;
    }
    else {
        h += row('method', `${r.method}, salt ${r.salt} M`) +
            (spLastModel && (r.method === 'v2' || r.method === 'v3' || r.method === 'm2') ? row('model', `${spLastModel} (single-chain RNA predictor)${spLastModel !== r.method ? `, engine ran ${r.method}` : ''}, build ${r.build ? esc(r.build.build) : '?'}`) : '') +
            row('nested MFE (Turner 2004, salt corrected)', `${r.energy.nestedMfe.toFixed(2)} kcal/mol`) +
            (r.energy.score !== undefined ? row('predictor score', r.energy.score.toFixed(2)) : '') +
            row('kissing / pseudoknot helices', r.helices.length ? r.helices.map(x => `${x.i}-${x.j} (${x.k} bp)`).join(', ') : 'none: the nested MFE is the answer') +
            timeRow + prov;
    }
    if (r.notes.length)
        h += row('notes', r.notes.map(esc).join('<br>'));
    h += '</table><p class="rr-note">' + (r.method === 'dna' || r.method === 'ssdna'
        ? 'A prediction, not a measurement (docs/71 and docs/73 of rigidDNA2): short stems and hairpins are mostly right, junctions, ligand-bound aptamers and kissing complexes are not; the G-quadruplex rule predicts the motif, not its topology. This module has no NUPACK (proprietary) and no scaffold-alignment / species-collapse step.'
        : r.method === 'msrna'
            ? 'A prediction, not a measurement: the answer to a kissing-complex versus extended-duplex question is a set of states, so the alternative states are listed (docs/73_multistrand.md of rigidDNA2). On blind entries MS-RNA is only marginally better than plain ViennaRNA co-folding.'
            : r.method === 'v3'
                ? 'A prediction, not a measurement: v3 adds closing-helix candidates to v2 (docs/74 section 12 of rigidDNA2); it was frozen without a held-out result, so v2 remains the validated predictor. On natural RNAs the kissing layer adds nothing to the nested MFE.'
                : 'A prediction, not a measurement: on natural RNAs the kissing layer adds nothing to the nested MFE (documented in docs/70_seqpred_cpp.md of rigidDNA2); it targets designed kissing-loop RNAs.') + '</p>';
    rrEl('spSummary').innerHTML = h;
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
/** Redraws the selection panel (arc diagram + ranked candidates); hides it for other methods. */
function spRenderSel() {
    const host = rrEl('spSel');
    if (!host)
        return;
    if (!spLast || (spLast.method !== 'v2' && spLast.method !== 'v3')) {
        host.style.display = 'none';
        return;
    }
    host.style.display = '';
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
function spApplyRef() {
    const msg = rrEl('spRefMsg');
    const done = (t, bad) => { if (msg) {
        msg.textContent = t;
        msg.style.color = bad ? '#c62828' : '';
    } };
    if (!spLast) {
        done('Predict a structure first.', true);
        return;
    }
    const a = spAdapt(spLast);
    const ref = rrEl('spRefDb').value.replace(/\s+/g, '');
    if (!ref) {
        spRefPairs = null;
        done('', false);
        spRenderSel();
        return;
    }
    if (ref.length !== a.length) {
        done(`The reference is ${ref.length} nt but the sequence is ${a.length} nt.`, true);
        return;
    }
    if (/[^().\[\]{}<>.\-:;_~]/.test(ref)) {
        done('Only the brackets ( ) [ ] { } < >, dots and - : ; _ ~ are supported.', true);
        return;
    }
    const st = { '(': [], '[': [], '{': [], '<': [] };
    const cl = { ')': '(', ']': '[', '}': '{', '>': '<' };
    for (let i = 0; i < ref.length; i++) {
        const c = ref[i];
        if (st[c])
            st[c].push(i + 1);
        else if (cl[c]) {
            if (!st[cl[c]].length) {
                done(`Unbalanced bracket ${c} at position ${i + 1}.`, true);
                return;
            }
            st[cl[c]].pop();
        }
    }
    for (const k of Object.keys(st))
        if (st[k].length) {
            done(`Unbalanced bracket ${k} (${st[k].length} unclosed).`, true);
            return;
        }
    spRefPairs = spDbPairs(ref);
    const pred = new Set((spSelIdx < a.candidates.length ? a.candidates[spSelIdx].pairs : a.pairs).map(p => p[0] + ',' + p[1]));
    const refS = new Set(spRefPairs.map(p => p[0] + ',' + p[1]));
    let tp = 0;
    pred.forEach(k => { if (refS.has(k))
        tp++; });
    const fp = pred.size - tp, fn = refS.size - tp;
    const f1 = (2 * tp + fp + fn) ? 2 * tp / (2 * tp + fp + fn) : 1;
    done(`Pair F1 ${f1.toFixed(3)} (${tp} shared, ${fp} only predicted, ${fn} only in reference).`, false);
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
    spRenderSel();
}
