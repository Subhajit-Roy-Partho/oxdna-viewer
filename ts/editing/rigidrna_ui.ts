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

let rrEngine: RnaEngine = new RnaEngine();
let rrRunning = false;
let spEngine: SeqpredEngine = new SeqpredEngine();   // seqpred: sequence -> secondary structure (wasm/seqpred)
let spRunning = false;
let spLast: SeqpredResult = null;
type RrMode = 'db' | 'predict' | 'seqpred' | 'pdb' | 'design';
let rrFile: { name: string; text: string } = null;   // the PDB / mmCIF / design file chosen in the file modes

function rrEl<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

function rrLog(line: string) {
    const el = rrEl('rrLog');
    if (!el) return;
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
}

function rrSetRunning(running: boolean) {
    rrRunning = running;
    rrEl<HTMLButtonElement>('rrRunBtn').disabled = running;
    rrEl<HTMLButtonElement>('rrCancelBtn').disabled = !running;
}

/** oncreate callback of view.createWindow('rigidDNAWindow', ...) via initRigidDnaHub */
function initRigidRnaWindow() {
    const threads = rrEl<HTMLInputElement>('rrThreads');
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
function rrMode(): RrMode { return (rrEl<HTMLSelectElement>('rrMode').value || 'db') as RrMode; }

/** "Input" select: shows the controls of the chosen input kind. */
function rrModeChanged() {
    const m = rrMode();
    const show = (id: string, on: boolean) => { const e = rrEl(id); if (e) e.style.display = on ? '' : 'none'; };
    show('rrBlkSeq', m === 'db' || m === 'predict' || m === 'seqpred');
    show('rrBlkDb', m === 'db' || m === 'seqpred');
    show('rrBlkSeqpred', m === 'seqpred');
    show('rrBlkPredict', m === 'predict');
    show('rrBlkFile', m === 'pdb' || m === 'design');
    show('rrBlkPdb', m === 'pdb');
    const file = rrEl<HTMLInputElement>('rrFile');
    if (file) {
        file.accept = m === 'pdb' ? '.pdb,.ent,.cif,.mmcif' : '.json';
        file.value = '';
    }
    rrFile = null;
    const lab = rrEl('rrFileLabel');
    if (lab) lab.textContent = m === 'pdb' ? 'PDB or mmCIF file (nucleotide frames and Leontis-Westhof base pairs are computed by the engine)' : 'rigidRNA design JSON (sequence, structure or pairs, strands, contacts)';
    const info = rrEl('rrFileInfo');
    if (info) info.textContent = 'No file chosen.';
    rrAdvChanged();
}

/** Reads the chosen file of the PDB / design modes. */
async function rrFileChosen(input: HTMLInputElement) {
    const f = input.files && input.files[0];
    if (!f) { rrFile = null; rrEl('rrFileInfo').textContent = 'No file chosen.'; rrAdvChanged(); return; }
    try {
        const text = await f.text();
        rrFile = { name: f.name, text };
        const atoms = rrMode() === 'pdb' ? (text.match(/^(ATOM|HETATM)/gm) || []).length || (text.match(/^(ATOM|HETATM)\s/gm) || []).length : 0;
        rrEl('rrFileInfo').textContent = `${f.name}: ${(text.length / 1024).toFixed(1)} kB` + (atoms ? `, ${atoms} atom records` : '') + '.';
    } catch (e) {
        rrFile = null;
        rrEl('rrFileInfo').textContent = 'Could not read ' + f.name + '.';
    }
    rrAdvChanged();
}

/** "Load example" button: a dumbbell of two 7 bp hairpins joined by a 4 nt linker (a minimal two-stem design). */
function rrExample() {
    rrEl<HTMLTextAreaElement>('rrSeq').value = 'GGGCGCGAAAACGCGCCCAAAAGGGCGCGAAAACGCGCCC';
    rrEl<HTMLTextAreaElement>('rrDb').value  = '(((((((....)))))))....(((((((....)))))))';
    rrAdvChanged();
}

/** Shows the Debye length of the chosen salt (oxRNA2: 0.3667 * sqrt(T/300 K) / sqrt(I) oxRNA units of 0.8518 nm). */
function rrSaltChanged() {
    const salt = parseFloat(rrEl<HTMLInputElement>('rrSalt').value), temp = parseFloat(rrEl<HTMLInputElement>('rrTemp').value) || 300;
    const el = rrEl('rrDebye');
    if (!(salt > 0)) { el.textContent = ''; return; }
    el.textContent = `Debye length ${(0.3667258 * Math.sqrt(temp / 300) / Math.sqrt(salt) * 0.8518).toFixed(2)} nm`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Advanced properties: the options of rd2_rna that can be set in the browser (apps/rd2_rna.cpp header, docs RNA_15, RNA_18, RNA_21, RNA_22).
// ---------------------------------------------------------------------------------------------------------------------------------------------

type RrKind = 'int' | 'num' | 'check' | 'ranges' | 'text';

interface RrOpt {
    id: string;            // field id (rra_<id>)
    flag: string;          // rd2_rna option
    key?: keyof RnaOptions;   // field of RnaOptions that rd2rna_api.js turns into the flag; without it the flag goes to `extra`
    group: string;
    kind: RrKind;
    label: string;
    def: string;           // documented default
    help: string;
    min?: number; max?: number; step?: number;
    wide?: boolean;
}

const RR_GROUPS: string[] = ['Helix model and relaxation', 'De novo layout (sequence + dot-bracket, design JSON, --layout)', 'Electrostatics, checks and constraints', 'Further options'];

function rrOpt(group: number, id: string, flag: string, key: keyof RnaOptions | null, kind: RrKind, label: string, def: string, help: string, more?: Partial<RrOpt>): RrOpt {
    return Object.assign({ id, flag, group: RR_GROUPS[group], kind, label, def, help }, key ? { key } : {}, more || {});
}

const RR_OPTS: RrOpt[] = [
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
const RR_NATIVE_ONLY: [string, string][] = [
    ['--keep-open A-B, --base-flip I[:DIST], --back-flip END:TARGET[:R0[:RATE]], --hold I:J[:R0]', 'write external-force entries for the oxRNA2 molecular dynamics (force files); the tab loads the .top and .dat only'],
    ['--constraint C', 'folding constraint of the predictor; its notation is documented in the engine (apps/rd2_fold.cpp), not exposed here'],
    ['--write-pdb', 'writes an approximate all-atom PDB next to the result; the worker returns the .top and .dat only'],
    ['--conf TOP DAT --pairs F', 'oxRNA configuration as start: choose a PDB file, or a design JSON, instead'],
    ['--params F, --template F, --out PREFIX', 'file paths: the parameter set and the template are embedded in the WebAssembly module'],
];

function rrAdvId(o: RrOpt, part?: string) { return 'rra_' + o.id + (part ? '_' + part : ''); }
function rrAdvInput(id: string): HTMLInputElement | null { return document.getElementById(id) as any; }

/** Builds the Advanced properties groups (in #rrAdvHost) from the table. Called once, when the window is created. */
function rrAdvBuild() {
    const host = document.getElementById('rrAdvHost');
    if (!host || host.childElementCount) return;
    const mk = (tag: string, cls?: string, text?: string): HTMLElement => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
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
                const inp = mk('input') as HTMLInputElement;
                inp.type = 'checkbox'; inp.id = rrAdvId(o);
                l.appendChild(inp); l.appendChild(mk('span', 'check')); l.appendChild(mk('span', 'caption', `${o.label} (${o.flag})`));
                cell.appendChild(l);
            } else {
                const lab = mk('label');
                lab.appendChild(document.createTextNode(o.label + ' '));
                if (o.flag) lab.appendChild(mk('code', 'text-small', o.flag));
                cell.appendChild(lab);
                const inp = mk('input') as HTMLInputElement;
                inp.id = rrAdvId(o);
                if (o.kind === 'int' || o.kind === 'num') {
                    inp.type = 'number'; inp.min = String(o.min); inp.max = String(o.max);
                    inp.step = o.kind === 'int' ? '1' : 'any';
                } else inp.type = 'text';
                inp.placeholder = o.kind === 'ranges' ? 'e.g. 0-3, 20-25' : (o.def ? 'default ' + o.def : '');
                cell.appendChild(inp);
            }
            const hint = mk('div', 'rd2-hint');
            hint.id = rrAdvId(o, 'hint');
            cell.appendChild(hint);
            row.appendChild(cell);
        }
        content.appendChild(row);
        frame.appendChild(heading); frame.appendChild(content);
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
    if (pane && !(pane as any).__rrWired) {
        (pane as any).__rrWired = true;
        pane.addEventListener('input', rrAdvChanged);
        pane.addEventListener('change', rrAdvChanged);
    }
}

interface RrAdvState {
    fields: RnaOptions;                          // the options that rd2rna_api.js turns into flags
    extra: string[];                             // everything else, verbatim
    problems: { id: string; msg: string }[];     // invalid entries: ignored
    set: number;                                 // options that are passed
}

/** Reads and checks every advanced field. Nothing invalid reaches the command line. */
function rrAdvRead(): RrAdvState {
    const st: RrAdvState = { fields: {}, extra: [], problems: [], set: 0 };
    const parseNum = (s: string, o: RrOpt, integer: boolean): { v?: number; err?: string } => {
        s = s.trim();
        if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return { err: 'not a number' };
        const v = Number(s);
        if (!isFinite(v)) return { err: 'not a number' };
        if (integer && !Number.isInteger(v)) return { err: 'must be a whole number' };
        if (o.min !== undefined && v < o.min) return { err: 'must be at least ' + o.min };
        if (o.max !== undefined && v > o.max) return { err: 'must be at most ' + o.max };
        return { v };
    };
    for (const o of RR_OPTS) {
        const el = rrAdvInput(rrAdvId(o));
        if (!el) continue;
        let value: any = undefined, flagArgs: string[] = null, err = '';
        if (o.kind === 'check') {
            if (el.checked) { value = true; flagArgs = [o.flag]; }
        } else if (o.kind === 'int' || o.kind === 'num') {
            const t = el.value.trim();
            if (t) {
                const r = parseNum(t, o, o.kind === 'int');
                if (r.err) err = r.err;
                else if ((o.key === 'dmin' || o.key === 'krep' || o.key === 'minStem' || o.key === 'elecScale') && !(r.v > 0)) err = 'must be above 0 (a blank field means the default)';
                else { value = r.v; flagArgs = [o.flag, String(r.v)]; }
            }
        } else if (o.kind === 'ranges') {
            const t = el.value.trim();
            if (t) {
                const parts = t.split(/[,;\s]+/).filter(Boolean);
                const bad = parts.find(p => { const m = /^(\d+)-(\d+)$/.exec(p); return !m || Number(m[1]) > Number(m[2]); });
                if (bad) err = `"${bad}" is not a range A-B with A <= B`; else { value = parts; flagArgs = parts.flatMap(p => [o.flag, p]); }
            }
        } else if (o.kind === 'text') {
            const t = el.value.trim();
            if (t) {
                const words = t.split(/\s+/);
                if (!words[0].startsWith('--')) err = 'must start with an option such as --no-gu';
                else if (words.some(w => /^--(out|params|template|seq|db|json|pdb|conf|pairs|predict|threads)$/.test(w))) err = 'inputs, outputs and threads are set by the tab';
                else flagArgs = words;
            }
        }
        const hint = document.getElementById(rrAdvId(o, 'hint'));
        const bad = !!err;
        if (bad) st.problems.push({ id: o.id, msg: err });
        if (hint) { hint.textContent = bad ? 'Ignored: ' + err + '.' : ''; hint.classList.toggle('rd2-bad', bad); }
        el.classList.toggle('rd2-invalid', bad);
        if (!flagArgs) continue;
        st.set++;
        if (o.key) (st.fields as any)[o.key] = value; else st.extra.push(...flagArgs);
    }
    return st;
}

/** The options object of the bridge: the basic controls plus the advanced fields. */
function rrOptions(): RnaOptions {
    const adv = rrAdvRead();
    const o: RnaOptions = {
        salt: parseFloat(rrEl<HTMLInputElement>('rrSalt').value) || 0.5,
        temp: parseFloat(rrEl<HTMLInputElement>('rrTemp').value) || 300,
        elec: rrEl<HTMLInputElement>('rrElec').checked,
        iters: parseInt(rrEl<HTMLInputElement>('rrIters').value) || 300,
        threads: parseInt(rrEl<HTMLInputElement>('rrThreads').value) || 1,
        ...adv.fields,
    };
    if (adv.extra.length) o.extra = adv.extra;
    const m = rrMode();
    if (m === 'predict') {
        const g = parseFloat(rrEl<HTMLInputElement>('rrGamma').value), s = parseInt(rrEl<HTMLInputElement>('rrMaxSpan').value);
        if (rrEl<HTMLSelectElement>('rrPredict').value === 'mea' && g > 0) o.gamma = g;
        if (s > 0) o.maxSpan = s;
    }
    if (m === 'pdb' && rrEl<HTMLInputElement>('rrLayout').checked) o.layout = true;
    return o;
}

/** The input of the run for the chosen mode, or an error text. */
function rrInput(): { input?: RnaInput; error?: string } {
    const m = rrMode();
    if (m === 'db' || m === 'predict' || m === 'seqpred') {
        const seq = rrEl<HTMLTextAreaElement>('rrSeq').value.replace(/\s+/g, '').toUpperCase().replace(/T/g, 'U');
        const bases = seq.replace(/[&\/]/g, '');
        if (!bases) return { error: 'Enter a sequence.' };
        if (/[^ACGUN&\/]/.test(seq)) return { error: 'The sequence may contain only A, C, G, U, N (T is read as U) and & or / between strands.' };
        if (m === 'predict') return { input: { seq, predict: rrEl<HTMLSelectElement>('rrPredict').value as RnaInput['predict'] } };
        const db = rrEl<HTMLTextAreaElement>('rrDb').value.replace(/\s+/g, '');
        const structure = db.replace(/[&\/]/g, '');
        if (m === 'seqpred' && !structure) return { error: 'Press "Predict structure" first: seqpred writes the predicted dot-bracket here (you can edit it before building).' };
        if (!structure || bases.length !== structure.length) return { error: `The sequence (${bases.length} nt) and the dot-bracket (${structure.length} characters) must have the same length.` };
        return { input: { seq, db } };
    }
    if (!rrFile) return { error: m === 'pdb' ? 'Choose a PDB or mmCIF file.' : 'Choose a design JSON file.' };
    if (m === 'pdb') {
        const chains = rrEl<HTMLInputElement>('rrChains').value.trim(), model = rrEl<HTMLInputElement>('rrModel').value.trim();
        if (chains && !/^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/.test(chains)) return { error: 'Chains: identifiers separated by commas, e.g. A,B.' };
        if (model && !/^(\d+|all)$/i.test(model)) return { error: 'Model: a number or all.' };
        const input: RnaInput = { pdb: rrFile.text };
        if (chains) input.chains = chains.replace(/\s+/g, '');
        if (model) input.model = model.toLowerCase();
        return { input };
    }
    try { JSON.parse(rrFile.text); } catch (e) { return { error: rrFile.name + ' is not valid JSON.' }; }
    return { input: { design: rrFile.text } };
}

function rrQuote(a: string): string { return /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'"; }

/** The command line that the run will give to rd2_rna: the option arguments are made by Rd2RnaApi.buildArgs of wasm/rigidrna/rd2rna_api.js, the very function the worker runs. */
function rrCommandLine(): { text: string; error?: string } {
    const api = (window as any).Rd2RnaApi;
    if (!api) return { text: '', error: 'the engine script (rd2rna_api.js) is not loaded yet' };
    try {
        const o = rrOptions();
        o.threads = Math.max(1, Math.min(o.threads || 1, RnaEngine.maxUsableThreads()));
        const m = rrMode();
        const short = (s: string) => (s.length > 48 ? s.slice(0, 40) + '...(' + s.length + ' nt)' : s);
        const seq = rrEl<HTMLTextAreaElement>('rrSeq').value.replace(/\s+/g, '').toUpperCase().replace(/T/g, 'U') || 'SEQUENCE';
        const db = rrEl<HTMLTextAreaElement>('rrDb').value.replace(/\s+/g, '') || 'DOT_BRACKET';
        let a: string[];
        if (m === 'db' || m === 'seqpred') a = ['--seq', short(seq), '--db', short(db)];
        else if (m === 'predict') a = ['--seq', short(seq), '--predict', rrEl<HTMLSelectElement>('rrPredict').value];
        else if (m === 'pdb') {
            a = ['--pdb', rrFile ? rrFile.name : 'structure.pdb'];
            const chains = rrEl<HTMLInputElement>('rrChains').value.trim().replace(/\s+/g, ''), model = rrEl<HTMLInputElement>('rrModel').value.trim().toLowerCase();
            if (chains) a.push('--pdb-chains', chains);
            if (model) a.push('--pdb-model', model);
        } else a = ['--json', rrFile ? rrFile.name : 'design.json'];
        a.push('--params', 'rna_elements_v1.json', '--template', 'rna_bp_template.json', '--out', 'out', ...api.buildArgs(o));
        return { text: ['rd2_rna', ...a].map(rrQuote).join(' ') };
    } catch (e) {
        return { text: '', error: String((e && e.message) || e) };
    }
}

/** Refreshes the hints, the count and the command line preview. */
function rrAdvChanged() {
    const st = rrAdvRead();
    const cmd = rrCommandLine();
    const pre = document.getElementById('rrCmd');
    if (pre) pre.textContent = cmd.error ? 'unavailable: ' + cmd.error : cmd.text;
    const cnt = document.getElementById('rrAdvCount');
    if (cnt) cnt.textContent = st.set ? `(${st.set} set${st.problems.length ? ', ' + st.problems.length + ' ignored' : ''})` : (st.problems.length ? `(${st.problems.length} ignored)` : '');
    const sum = document.getElementById('rrAdvProblems');
    if (sum) sum.textContent = st.problems.length ? `${st.problems.length} entr${st.problems.length === 1 ? 'y is' : 'ies are'} invalid and will not be passed to the engine (marked in red).` : '';
}

/** "Reset advanced" button: every advanced field back to blank (engine default). */
function rrAdvReset() {
    for (const o of RR_OPTS) {
        const el = rrAdvInput(rrAdvId(o));
        if (!el) continue;
        if (o.kind === 'check') el.checked = false; else el.value = '';
    }
    rrAdvChanged();
}

/** "Copy" button of the command line preview. */
async function rrCopyCommand() {
    const t = document.getElementById('rrCmd').textContent;
    try { await navigator.clipboard.writeText(t); notify('Command line copied.'); } catch (e) { notify('Could not copy: select the text and copy it by hand.', 'warn'); }
}

/** "Build and load" button. */
async function rrRun() {
    if (rrRunning) return;
    const got = rrInput();
    if (!got.input) { notify(got.error, 'alert'); return; }
    rrEl('rrLog').textContent = '';
    rrEl('rrSummary').innerHTML = '';
    const label = rrEl('rrStage');
    rrSetRunning(true);
    const t0 = performance.now();
    try {
        label.textContent = 'Starting the engine...';
        const opts = rrOptions();
        const cmd = rrCommandLine();
        if (cmd.text) rrLog('$ ' + cmd.text);
        const r = await rrEngine.run(got.input, opts, (line) => {
            rrLog(line);
            const m = /^\[[\d.]+s\] (.*)$/.exec(line) || /^\s*(stage .*)$/.exec(line);
            if (m) label.textContent = m[1].slice(0, 110);
        });
        label.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s (${r.variant === 'mt' ? r.threads + ' threads' : 'single thread'}).`;
        rrShowSummary(r, rrMode());
        if (r.rc !== 0 || !r.top || !r.dat) { notify('rigidRNA produced no structure: ' + (r.log.split('\n').filter(l => /error|unknown|cannot|unbalanced|differ/i.test(l)).pop() || 'see the log'), 'alert'); return; }
        const name = rrFile && (rrMode() === 'pdb' || rrMode() === 'design') ? rrFile.name.replace(/\.[^.]+$/, '') : 'rigidRNA';
        handleFiles([new File([r.top], name + '.top'), new File([r.dat], name + '.dat')]);
    } catch (e) {
        label.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Failed: ' + e.message;
        if (e.message !== 'cancelled') notify('rigidRNA failed: ' + e.message, 'alert');
    } finally {
        rrSetRunning(false);
    }
}

/** "Cancel" button: stops the worker. */
function rrCancel() { if (rrRunning) rrEngine.cancel(); }

function rrShowSummary(r: RnaResult, mode: RrMode) {
    const rep = r.report;
    if (!rep) return;
    const row = (k: string, v: any) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const rel = rep.relaxed || {};
    const f = (x: number) => (x === undefined ? '-' : x.toPrecision(3));
    const esc = (s: string) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    let h = '<table class="table compact row-hover">' +
        row('input', { db: 'sequence + dot-bracket', seqpred: 'sequence + structure predicted by seqpred' + (spLast && spLast.build ? ' (build ' + spLast.build.build + ')' : ''), predict: 'sequence only, structure predicted by the engine', pdb: 'PDB / mmCIF file', design: 'design JSON' }[mode]) +
        row('nucleotides', rep.n_nt);
    if (mode === 'predict') {
        const db = rrPredictedStructure(r);
        if (db) h += row('predicted structure', `<span style="font-family: monospace; word-break: break-all;">${esc(db)}</span>`);
    }
    h += row('model energy (oxRNA units, 1 = 10 kT)', `step ${f(rel.step)}, cable ${f(rel.cable)}, repulsion ${f(rel.rep)}${rel.elec !== undefined ? ', electrostatic ' + f(rel.elec) : ''}, total ${f(rel.total)}`);
    if (rep.elec) h += row('electrostatics', `oxRNA2 Debye-Hueckel, ${rep.elec.salt} M, Debye length ${(rep.elec.lambda * 0.8518).toFixed(2)} nm, ${rep.elec.site_pairs} charged site pairs`);
    if (rep.substructures) h += row('stems / loops', `${rep.substructures.stems} / ${rep.substructures.loops}`);
    const flags: any[] = rep.flags || (r.flags && r.flags.flags) || [];
    h += row('flags', `${flags.length}` + (flags.length ? ' (' + Object.entries(flags.reduce((c: any, x: any) => (c[x.type || x.kind || 'flag'] = (c[x.type || x.kind || 'flag'] || 0) + 1, c), {})).map(([k, n]) => `${k} ${n}`).join(', ') + ')' : ''));
    h += row('time', `${(rep.seconds || 0).toFixed(1)} s in the engine, ${r.seconds.toFixed(1)} s with I/O`) + '</table>';
    rrEl('rrSummary').innerHTML = h;
}

/** The dot-bracket the predictor chose, from the report or the log of a sequence-only run. */
function rrPredictedStructure(r: RnaResult): string {
    const rep = r.report || {};
    for (const k of ['predicted_db', 'predicted_structure', 'db', 'structure']) if (typeof rep[k] === 'string' && rep[k]) return rep[k];
    const m = /^\s*(?:predicted|structure|db)[^\n:=]*[:=]\s*([.()\[\]{}<>A-Za-z&\/]{5,})\s*$/im.exec(r.log || '');
    return m ? m[1] : '';
}


// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// seqpred: "Sequence only: predict with seqpred" input. The predicted dot-bracket is written to the dot-bracket field (editable), then "Build and load" is the ordinary
// rigidRNA run. The module runs in its own worker (wasm/seqpred, SeqpredEngine); nothing leaves the browser.

function spOptions(): SeqpredOptions {
    const o: SeqpredOptions = {
        method: rrEl<HTMLSelectElement>('spMethod').value as SeqpredOptions['method'],
        salt: parseFloat(rrEl<HTMLInputElement>('spSalt').value) || 0.25,
        budgetSeconds: Math.max(0, parseFloat(rrEl<HTMLInputElement>('spBudget').value) || 0),
        threads: parseInt(rrEl<HTMLInputElement>('rrThreads').value) || 1,
    };
    return o;
}

/** "Predict structure" button of the seqpred input. */
async function spPredict() {
    if (spRunning) return;
    const seq = rrEl<HTMLTextAreaElement>('rrSeq').value.replace(/\s+/g, '').toUpperCase().replace(/T/g, 'U');
    if (!seq) { notify('Enter a sequence.', 'alert'); return; }
    if (/[^ACGU]/.test(seq)) { notify('seqpred takes a single strand of A, C, G, U (T is read as U).', 'alert'); return; }
    const st = rrEl('spStage');
    spRunning = true;
    rrEl<HTMLButtonElement>('spRunBtn').disabled = true; rrEl<HTMLButtonElement>('spCancelBtn').disabled = false;
    rrEl('spSummary').innerHTML = '';
    const t0 = performance.now();
    const tick = window.setInterval(() => { st.textContent = `Predicting... ${((performance.now() - t0) / 1000).toFixed(0)} s (one thread: about 30 s for 150 nt, minutes for 400 nt with the long-range search)`; }, 1000);
    try {
        st.textContent = 'Starting seqpred...';
        const r = await spEngine.predict(seq, spOptions());
        spLast = r;
        rrEl<HTMLTextAreaElement>('rrDb').value = r.dotbracket;
        st.textContent = `Done in ${r.wallSeconds.toFixed(1)} s: ${r.pairs.length} base pairs, ${r.helices.length} kissing / pseudoknot helices.`;
        spShowSummary(r);
        rrAdvChanged();
    } catch (e) {
        st.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Failed: ' + e.message;
        if (e.message !== 'cancelled') notify('seqpred failed: ' + e.message, 'alert');
    } finally {
        window.clearInterval(tick);
        spRunning = false;
        rrEl<HTMLButtonElement>('spRunBtn').disabled = false; rrEl<HTMLButtonElement>('spCancelBtn').disabled = true;
    }
}

function spCancel() { if (spRunning) spEngine.cancel(); }

function spShowSummary(r: SeqpredResult) {
    const esc = (s: string) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const row = (k: string, v: any) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    let h = '<table class="table compact row-hover">' +
        row('method', `${r.method}, salt ${r.salt} M`) +
        row('nested MFE (Turner 2004, salt corrected)', `${r.energy.nestedMfe.toFixed(2)} kcal/mol`) +
        (r.energy.score !== undefined ? row('predictor score', r.energy.score.toFixed(2)) : '') +
        row('kissing / pseudoknot helices', r.helices.length ? r.helices.map(x => `${x.i}-${x.j} (${x.k} bp)`).join(', ') : 'none: the nested MFE is the answer') +
        row('time', `${(r.timings.total as number).toFixed(1)} s in the engine, ${r.wallSeconds.toFixed(1)} s with loading (${r.variant === 'mt' ? 'threaded' : 'single thread'} build)`) +
        row('provenance', `seqpred ${esc(r.version.seqpred)}, ${esc(r.version.predictor)}, ViennaRNA ${esc(r.version.viennarna)}, build ${r.build ? esc(r.build.build) : '?'} (${r.build ? esc(r.build.engine) : 'build.json not found'})`);
    if (r.notes.length) h += row('notes', r.notes.map(esc).join('<br>'));
    h += '</table><p class="rr-note">A prediction, not a measurement: on natural RNAs the kissing layer adds nothing to the nested MFE (documented in docs/70_seqpred_cpp.md of rigidDNA2); it targets designed kissing-loop RNAs. Check the arc plot of the result before building.</p>';
    rrEl('spSummary').innerHTML = h;
}
