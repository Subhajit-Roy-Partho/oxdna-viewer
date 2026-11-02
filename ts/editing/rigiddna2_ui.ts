/**
 * rigiddna2_ui.ts
 *
 * UI glue for the rigidDNA2 tab of windows/rigidDNAWindow.html: choose (or drop) a caDNAno / scadnano design, run the rigidDNA2 WebAssembly pipeline
 * (rigiddna2_bridge.ts, in a Web Worker, with progress and cancel) and load the relaxed oxDNA .top/.dat through the viewer's ordinary file path
 * (handleFiles), so the result is a normal system in the scene.
 */

let rd2Engine: Rd2Engine = new Rd2Engine();
let rd2Design: { name: string; text: string; dat?: string } = null;
let rd2Running = false;

function rd2El<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

function rd2Log(line: string) {
    const el = rd2El('rd2Log');
    if (!el) return;
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
}

function rd2SetRunning(running: boolean) {
    rd2Running = running;
    rd2El<HTMLButtonElement>('rd2RunBtn').disabled = running || rd2Design === null;
    rd2El<HTMLButtonElement>('rd2CancelBtn').disabled = !running;
}

/** Overall progress in 0..1 from the stage events of the engine (indicative: the coarse and native stages have no fixed length). */
function rd2Fraction(p: Rd2Progress): number {
    const part = (a: number, b: number, f: number) => a + (b - a) * Math.max(0, Math.min(1, f));
    switch (p.stage) {
        case 'front end': return 0.02;
        case 'coarse': {
            if (p.steps > 0) { rd2CoarseStep = p.step; rd2CoarseSteps = p.steps; }
            const inStage = p.maxIter > 0 ? p.iter / p.maxIter : 0;
            return part(0.03, 0.70, (rd2CoarseStep + inStage) / Math.max(1, rd2CoarseSteps));
        }
        case 'export': return 0.72;
        case 'native': return p.maxIter > 0 ? part(0.75, 0.97, p.iter / p.maxIter) : 0.75;
        case 'recovery': return 0.97;
        default: return 0;
    }
}
let rd2CoarseStep = 0, rd2CoarseSteps = 1;

function rd2StageLabel(p: Rd2Progress): string {
    switch (p.stage) {
        case 'front end': return 'Reading the design';
        case 'coarse': return `Coarse rigid-body relaxation${p.steps > 0 ? ` (stage ${p.step + 1}/${p.steps})` : ''}${p.energy ? `, E ${p.energy.toPrecision(4)}` : ''}`;
        case 'export': return 'Building nucleotides';
        case 'native': return `oxDNA2 relaxation, iteration ${p.iter}${p.energy ? `, E/nt ${p.energy.toFixed(3)}` : ''}`;
        case 'recovery': return `Recovery: ${p.text}`;
        default: return p.text || p.stage;
    }
}

/** oncreate callback of view.createWindow('rigidDNAWindow', ...) via initRigidDnaHub */
function initRigidDna2Window() {
    const cap = Rd2Engine.capabilities();
    const threads = rd2El<HTMLInputElement>('rd2Threads');
    const maxT = Rd2Engine.maxUsableThreads();
    threads.max = String(Math.max(1, maxT));
    threads.value = String(Math.max(1, Math.min(maxT, 4)));
    threads.disabled = maxT <= 1;
    const info = rd2El('rd2Engine');
    info.innerHTML = cap.isolated
        ? `Multi-core build available (cross-origin isolated, ${cap.cores} logical cores, up to ${maxT} threads).`
        : `Single-thread build (this page is not cross-origin isolated, so SharedArrayBuffer and threads are unavailable). ` +
          `<a href="#" onclick="rd2EnableIsolation(); return false;">Enable multi-core via service worker (reloads the page)</a>`;
    rd2El('rd2Gpu').textContent = cap.webgpu ? 'Checking WebGPU...' : 'WebGPU not available; the relaxation runs on the CPU (WebAssembly).';
    if (cap.webgpu) Rd2Engine.probeGpu().then((g) => {
        rd2El('rd2Gpu').textContent = (g.available ? `WebGPU: ${g.adapter || 'adapter'}${g.software ? ' (software)' : ''}. ` : `WebGPU: ${g.note}. `) +
            'The relaxation has no WebGPU path yet and runs on the CPU (WebAssembly).';
    });
    const drop = rd2El('rd2Drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('rd2-over'); };
    drop.ondragleave = () => drop.classList.remove('rd2-over');
    drop.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('rd2-over'); rd2Files(Array.from(e.dataTransfer.files)); };
    rd2AdvBuild();
    Rd2Engine.loadApi().then(() => rd2AdvChanged()).catch(() => rd2AdvChanged());
    rd2AdvChanged();
    if (rd2Pending) { const f = rd2Pending; rd2Pending = null; rd2Files([f]); }
    rd2SetRunning(false);
}

/** Design waiting for the window to be created (see rd2OfferDesign). */
let rd2Pending: File = null;

/** "Choose file" input of the window. */
function rd2Choose(input: HTMLInputElement) { rd2Files(Array.from(input.files)); input.value = ''; }

/** Takes a design file (caDNAno .json, scadnano .sc) and, for an oxDNA .top, its .dat when both were given. */
async function rd2Files(files: File[]) {
    const main = files.find(f => /\.(json|sc|top)$/i.test(f.name));
    if (!main) { notify('rigidDNA2 reads a caDNAno .json, a scadnano .sc or an oxDNA .top (with its .dat).', 'alert'); return; }
    const d: { name: string; text: string; dat?: string } = { name: main.name, text: await main.text() };
    if (/\.top$/i.test(main.name)) {
        const dat = files.find(f => /\.(dat|conf|oxdna)$/i.test(f.name));
        if (!dat) { notify('An oxDNA topology needs its configuration (.dat) too: select both files.', 'alert'); return; }
        d.dat = await dat.text();
    }
    rd2Design = d;
    rd2El('rd2File').textContent = `${d.name} (${(d.text.length / 1024).toFixed(0)} kB)`;
    rd2SetRunning(false);
    rd2AdvChanged();
}

/**
 * Called by handleFiles for a dropped .json / .sc file: a caDNAno or scadnano design is not something the viewer can read itself, so it is offered
 * to the rigidDNA2 tab (which then holds it, ready to run). Returns true when the file was taken.
 */
async function rd2OfferDesign(file: File): Promise<boolean> {
    const lower = file.name.toLowerCase();
    let isDesign = lower.endsWith('.sc');
    if (!isDesign && lower.endsWith('.json')) {
        const head = await file.slice(0, 65536).text();
        isDesign = head.indexOf('"vstrands"') >= 0;
    }
    if (!isDesign) return false;
    notify(`${file.name} is a DNA origami design: opening the rigidDNA2 tab to relax it in your browser.`);
    const w = document.getElementById('rigidDNAWindow');
    if (!w) {
        rd2Pending = file;   // taken by initRigidDna2Window once the window exists
        rigidDnaOpen(2);
    } else {
        if (rigidDnaHubTab !== 2 || w.style.display === 'none') { Metro.window.show(w); rigidDnaShowTab(2); }
        rd2Files([file]);
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Advanced properties: every rd2_run option that makes sense in the browser, as typed fields. The table below is the single source of the
// fields, of their validation and of the command line: a blank field passes nothing (the engine default applies), a field that fails its
// check is NOT passed and shows why. The one-liners are those of the engine's own documentation (apps/rd2_run.cpp, apps/rd2_relax.cpp,
// apps/rd2_pipeline.cpp, include/rd2/*.h, docs/), see docs/RIGIDDNA2_OPTIONS.md for the full table with the sources.
// ---------------------------------------------------------------------------------------------------------------------------------------------

type Rd2Kind = 'int' | 'num' | 'select' | 'check' | 'ints' | 'nums' | 'pair' | 'flagsel';

interface Rd2Opt {
    id: string;                 // field id (rd2a_<id>) and key
    flag: string;               // rd2_run option; for 'flagsel' the flags are in `flags`
    group: string;
    kind: Rd2Kind;
    label: string;
    def: string;                // the documented default ("" = nothing special)
    help: string;               // doc one-liner
    min?: number; max?: number; step?: number;
    choices?: string[];         // select: values passed verbatim; flagsel: keys of `flags`
    flags?: { [choice: string]: string };
    field?: 'lattice' | 'seed' | 'nativeIters';   // first-class field of Rd2Options (same command line, set by the bridge)
    wide?: boolean;             // full row
}

const RD2_GROUPS: string[] = [
    'Route and layout', 'Relocation of the bodies', 'Orientation search', 'Coarse relaxation', 'Excluded volume and subhoTropy', 'Multilevel cascade',
    'Model elements', 'oxDNA input (.top + .dat)', 'Design file, sequence and gap linkers', 'Native oxDNA2 relaxation and export', 'Solver (expert)', 'Diagnostics and output',
];

function rd2Opt(group: number, id: string, flag: string, kind: Rd2Kind, label: string, def: string, help: string, more?: Partial<Rd2Opt>): Rd2Opt {
    return Object.assign({ id, flag, group: RD2_GROUPS[group], kind, label, def, help }, more || {});
}
const ONOFF = ['auto', 'on', 'off'];

const RD2_OPTS: Rd2Opt[] = [
    // --- route and layout
    rd2Opt(0, 'lattice', '--lattice', 'select', 'Lattice type', 'auto', 'square or honeycomb helix packing; auto: the file\'s own grid/tag, else detected from the crossovers', { choices: ['square', 'honeycomb'], field: 'lattice' }),
    rd2Opt(0, 'wireframe', '--wireframe', 'select', 'Wireframe designs', 'auto', 'free-form wireframe designs (no lattice-neighbour crossovers, crossovers at helix ends): layout from the junction graph, no gap linkers', { choices: ONOFF.slice(1) }),
    rd2Opt(0, 'phaseEmbed', '--phase-embed', 'select', 'Phase embedding', 'auto', 'helix axes from the phase of the crossovers when the lattice cells of a caDNAno design contradict them (flat sheet drawn as a compact serpentine, docs/35)', { choices: ONOFF.slice(1) }),
    rd2Opt(0, 'bundleLayout', '--bundle-layout', 'select', 'Bundle graph layout', 'auto', 'bundles as the edges of a polyhedron or mesh (icosahedron, 4-helix-bundle meshes): the articulated route starts from a graph embedding of the bundles (docs/27)', { choices: ONOFF.slice(1) }),
    rd2Opt(0, 'articulated', '--articulated', 'select', 'Articulated route rule', 'auto', 'many bundles joined by long-range crossovers (Trifolium): relocation route without gap linkers and lattice start', { choices: ONOFF.slice(1) }),
    rd2Opt(0, 'articulatedMin', '--articulated-min-bodies', 'int', 'Articulated: fewest substructures', '8', 'auto route: fewest substructures for the articulated rule', { min: 1, max: 100000, step: 1 }),
    rd2Opt(0, 'start', '--start', 'select', 'Start of the coarse relaxation', 'ideal', 'ideal: ideal helix geometry of the design (no relocation); lattice: the lattice start', { choices: ['ideal', 'lattice'] }),
    rd2Opt(0, 'stapleLength', '--staple-length', 'int', 'Inferred staple length (nt)', '32', 'length of the inferred staples (nucleotides, at most); used when "Infer staples" adds staples', { min: 1, max: 1000, step: 1 }),
    rd2Opt(0, 'keepWrap', '--keep-wrap-links', 'check', 'Keep wrap links', '', 'keep backbone links from the end of a helix to its start inside a rigid stack that cannot close into a ring (default: cut, docs/26)'),
    rd2Opt(0, 'planeK', '--plane-k', 'num', 'Plane wall stiffness', 'auto', 'wall k/2 (n.p - q)^2 around the plane of a flat layout during the coarse relaxation (docs/30); default 0.0003 when the layout is flat, 0 = off', { min: 0, max: 1000 }),
    rd2Opt(0, 'planeFlat', '--plane-flat', 'num', 'Flatness threshold', '0.15', 'the start layout counts as flat when its thin axis rms is below this fraction of its middle axis rms', { min: 0, max: 1 }),
    // --- relocation
    rd2Opt(1, 'noReloc', '--no-reloc', 'check', 'Skip the relocation', '', 'skip the relocation step'),
    rd2Opt(1, 'dist', '--dist', 'select', 'Relocation distance model', '2', 'distance model of the relocation: 0 paper, 1 pair-diagonal, 2 bond-based', { choices: ['0', '1', '2'] }),
    rd2Opt(1, 'restarts', '--restarts', 'int', 'Relocation restarts', '0', 'random restarts of the relocation (planar and free 3D)', { min: 0, max: 10000, step: 1 }),
    rd2Opt(1, 'noPlanar', '--no-planar', 'check', 'Free 3D relocation', '', 'free 3D relocation instead of the planar one (docs/25)'),
    rd2Opt(1, 'noRing', '--no-ring-layout', 'check', 'No polygon layout of rings', '', 'skip the polygon layout of a cycle of bundles (docs/25)'),
    rd2Opt(1, 'noBarLoop', '--no-bar-loop', 'check', 'No loop-of-bars layout', '', 'switch the loop-of-bars layout off (docs/31)'),
    rd2Opt(1, 'rowSign', '--row-sign', 'select', 'Row axis sign', '0', '0: choose by crossover fit, +1/-1: force the sign of the row axis (lattice handedness)', { choices: ['-1', '0', '1'] }),
    // --- orientation search
    rd2Opt(2, 'orientSearch', '--orient-search', 'int', 'Random starts', 'off', 'free SO(3) orientation search of the rigid bundles (N random starts, 6 DOF per bundle) before the relaxation, for designs whose bundles must cross or tilt (docs/15); where the lattice cannot give the pose of a few bodies the front end switches it on by itself (docs/32)', { min: 0, max: 100000, step: 1 }),
    rd2Opt(2, 'orientSeed', '--orient-seed', 'int', 'Search seed', '1', 'random seed of the orientation search', { min: 0, max: 2147483647, step: 1 }),
    rd2Opt(2, 'orientFast', '--orient-fast', 'check', 'v2 search', '', 'with a number of starts: v2 search (cell-list repulsion, screened starts), best minimum only (docs/17)'),
    rd2Opt(2, 'orientKeep', '--orient-keep', 'int', 'Keep K minima', '0', 'v2 search keeping K distinct body-level minima, ranked on the rigid-segment path (needs --from-poses, which the browser cannot give: then the ranking is skipped); implies --multilevel (docs/17)', { min: 0, max: 1000, step: 1 }),
    rd2Opt(2, 'orientScreen', '--orient-screen', 'pair', 'Screening: iterations, kept starts', '30, max(40, starts/6)', 'IT KEEP of the v2 search: iterations of the screening and number of screened starts kept (IT <= 0 / KEEP 0: the defaults)', { min: 0, max: 100000, step: 1 }),
    rd2Opt(2, 'orientRound', '--orient-round', 'check', 'Round candidates only', '', 'only round candidates compete in the ranking (docs/17)'),
    rd2Opt(2, 'orientProbe', '--orient-probe', 'int', 'Probe iterations', '40', 'node-level iterations of the candidate ranking', { min: 1, max: 100000, step: 1 }),
    // --- coarse relaxation
    rd2Opt(3, 'dmin', '--dmin', 'num', 'Helix repulsion distance', '2.8', 'helix-axis repulsion distance (oxDNA length units)', { min: 0.1, max: 20, step: 0.1 }),
    rd2Opt(3, 'krep', '--krep', 'num', 'Repulsion stiffness', '5', 'stiffness of the helix-axis repulsion', { min: 0, max: 100000, step: 1 }),
    rd2Opt(3, 'iters', '--iters', 'int', 'Iterations per stage', '400', 'Levenberg-Marquardt iterations per continuation stage', { min: 1, max: 100000, step: 1 }),
    rd2Opt(3, 'stages', '--stages', 'int', 'Continuation stages', 'auto', 'continuation stages of the node level (default: automatic)', { min: 1, max: 1000, step: 1 }),
    rd2Opt(3, 'noMultilevel', '--no-multilevel', 'check', 'No multilevel cascade', '', 'plain five-stage coarse relaxation instead of the three-layer cascade (rd2_run uses --multilevel by default)'),
    rd2Opt(3, 'multilevel', '--multilevel', 'check', 'Multilevel cascade', 'on', 'coarse-to-fine hierarchy (docs/10): rigid helix segments are optimised before the node-level relaxation; already the default of rd2_run'),
    rd2Opt(3, 'legacy', '--legacy', 'check', 'Legacy algorithm', '', 'one switch back to the previous algorithm: same as --no-exc, ignores --subho and --multilevel, results equal the pre-subhoTropy code exactly (docs/11)'),
    // --- excluded volume, subhoTropy
    rd2Opt(4, 'exc', '--exc', 'num', 'Excluded volume scale', '1', 'nucleotide excluded volume (oxDNA backbone/base site potential) scaled by S between the nucleotides of different base-pair nodes; 0 = off (docs/09)', { min: 0, max: 1000 }),
    rd2Opt(4, 'noExc', '--no-exc', 'check', 'No excluded volume', '', 'switch the nucleotide excluded volume off (same as --exc 0): the previous model and results exactly'),
    rd2Opt(4, 'excStages', '--exc-stages', 'int', 'Excluded volume stages', '2', 'apply it in the last K dmin stages only (the early stages start from overlapping sheets)', { min: 1, max: 1000, step: 1 }),
    rd2Opt(4, 'subho', '--subho', 'num', 'subhoTropy strength', '0 (off)', 'maximum-entropy spreading term -L*mean ln(bead distance) added to the energy; an energy, 0 = off (docs/08)', { min: 0, max: 100000 }),
    rd2Opt(4, 'subhoBead', '--subho-bead', 'int', 'subhoTropy base pairs per bead', '32', 'base pairs per bead of the spreading term', { min: 1, max: 100000, step: 1 }),
    rd2Opt(4, 'subhoScope', '--subho-scope', 'select', 'subhoTropy scope', '0', '0 pairs not on one helix, 1 pairs of different substructures, 2 all pairs', { choices: ['0', '1', '2'] }),
    rd2Opt(4, 'subhoDsat', '--subho-dsat', 'num', 'subhoTropy saturation distance', '80', 'ln d is continued linearly beyond D', { min: 0.1, max: 100000 }),
    rd2Opt(4, 'subhoRamp', '--subho-ramp', 'int', 'subhoTropy ramp stages', '1', 'the strength ramps up over K stages', { min: 1, max: 1000, step: 1 }),
    rd2Opt(4, 'subhoRelease', '--subho-release', 'int', 'subhoTropy release stages', '0', 'the term is switched off for the last K continuation stages: spread first, then relax to the model minimum', { min: 0, max: 1000, step: 1 }),
    // --- multilevel
    rd2Opt(5, 'mlStages', '--ml-stages', 'int', 'Fine stages after the cascade', '1', 'fine dmin stages after the segment cascade', { min: 1, max: 1000, step: 1 }),
    rd2Opt(5, 'mlCut', '--ml-cut', 'int', 'Single level: segment length (bp)', '', 'one single level of that segment length, e.g. 150 = one per helix', { min: 1, max: 100000, step: 1 }),
    rd2Opt(5, 'mlCuts', '--ml-cuts', 'ints', 'Cascade of segment lengths (bp)', '40,12', 'cascade of cut lengths, coarse to fine, comma separated', { min: 1, max: 100000, wide: true }),
    rd2Opt(5, 'mlIters', '--ml-iters', 'int', 'Iterations per stage', '150', 'iterations per stage of the middle layer', { min: 1, max: 100000, step: 1 }),
    rd2Opt(5, 'mlDmin', '--ml-dmin', 'nums', 'dmin stages of the middle layer', '2.8', 'dmin stages of the middle layer, comma separated', { min: 0.1, max: 20, wide: true }),
    // --- model elements
    rd2Opt(6, 'noSeqDep', '--no-seq-dep', 'check', 'Sequence-averaged steps', '', 'use the sequence-averaged step elements even if a sequence is available (old behaviour)'),
    rd2Opt(6, 'noSsWlc', '--no-ss-wlc', 'check', 'Tension-only single strands', '', 'unpaired runs as tension-only cables (old behaviour) instead of worm-like-chain springs'),
    rd2Opt(6, 'xoScaf', '--xo-scaf', 'select', 'Scaffold crossover element', 'off', 'also apply a scaffold-crossover pose element of the v2 parameter file: sym = derived from the staple element by relabelling the strands, measured = pentagon U-turn element (weakly determined)', { choices: ['sym', 'measured'] }),
    rd2Opt(6, 'noXo', '--no-xo', 'check', 'No crossover pose element', '', 'do not use the crossover pose element'),
    rd2Opt(6, 'xoElement', '--xo-element', 'check', 'Crossover pose element', 'on', 'use the crossover pose element (the default; accepted for compatibility)'),
    rd2Opt(6, 'xoScale', '--xo-scale', 'num', 'Crossover stiffness scale', '3', 'multiplies the stiffness of the crossover pose elements', { min: 0.01, max: 1000 }),
    // --- oxDNA input
    rd2Opt(7, 'oxStart', '--ox-start', 'select', 'Start from the input structure', 'off', 'oxDNA input: start from the base-pair frames of the input configuration itself (a relaxation of the deposited conformation) instead of the relocation of the derived design\'s bodies (docs/34)', { choices: ['on', 'off'] }),
    rd2Opt(7, 'oxPairExtend', '--ox-pair-extend', 'num', 'Pair extension distance', '0', 'oxDNA input: base-site distance up to which a nucleotide that continues a found duplex is paired (0 = only the strict 0.9 test; 2.0 for unrelaxed configurations with stretched pairs)', { min: 0, max: 20, step: 0.1 }),
    rd2Opt(7, 'inputLayout', '--input-layout', 'select', 'Use the input arrangement', 'auto', 'oxDNA input: off = the relocation only; auto = use the arrangement of the input where the relocation does not satisfy the bonds between the bodies; on = always (docs/35)', { choices: ['off', 'on'] }),
    rd2Opt(7, 'inputLayoutCost', '--input-layout-cost', 'num', 'Input arrangement threshold', '4', 'mean-square bond length between the bodies above which auto takes the arrangement of the input (docs/35)', { min: 0, max: 1000 }),
    // --- design file, sequence, gap linkers
    rd2Opt(8, 'noNormalize', '--no-normalize', 'check', 'Do not repair links', '', 'do not repair self-pointing prev/next links (the parser then refuses such a file)'),
    rd2Opt(8, 'normalizeMode', '--normalize-mode', 'select', 'Link repair mode', 'auto', 'repair mode: self = unambiguous self-prev pointers, rebuild = rebuild prev from next, auto = self where unambiguous, else rebuild', { choices: ['self', 'rebuild', 'auto'] }),
    rd2Opt(8, 'strictMods', '--strict-modifications', 'check', 'Refuse strand modifications', '', 'scadnano: refuse designs with strand modifications instead of ignoring them'),
    rd2Opt(8, 'randomSeq', '--random-seq', 'check', 'Random placeholder sequence', '', 'placeholder sequence: random (see the seed) instead of the periodic A,T,G,C'),
    rd2Opt(8, 'seed', '--seed', 'int', 'Placeholder sequence seed', '1', 'seed of the placeholder sequence', { min: 0, max: 2147483647, step: 1, field: 'seed' }),
    rd2Opt(8, 'linkThreshold', '--link-threshold', 'num', 'Gap linker threshold', '3.8', 'a link longer than this (oxDNA units) in the ideal geometry gets linker nucleotides', { min: 0, max: 1000 }),
    rd2Opt(8, 'linkSuPerNt', '--link-su-per-nt', 'num', 'Gap linker length per nt', '1.8', 'oxDNA units spanned by one linker nucleotide', { min: 0.01, max: 1000 }),
    // --- native relaxation and export
    rd2Opt(9, 'nativeIters', '--native-iters', 'int', 'Iterations per native round', '1500', 'iterations per round of the native oxDNA2 relaxation', { min: 1, max: 1000000, step: 1, field: 'nativeIters' }),
    rd2Opt(9, 'ftol', '--ftol', 'num', 'Force tolerance', '2', 'the native relaxation stops when every |force| and |torque| is below this (oxDNA units)', { min: 0.001, max: 1000 }),
    rd2Opt(9, 'noDh', '--no-dh', 'check', 'No Debye-Hueckel term', '', 'leave the Debye-Hueckel term out of the minimised energy (it stays in the reported energy)'),
    rd2Opt(9, 'active', '--active', 'flagsel', 'Active-region relaxation', 'on', 'FIRE on the active region only with full evaluations in between (on, default) or on every nucleotide at every iteration (off) (docs/23)', { choices: ['on', 'off'], flags: { on: '--active', off: '--no-active' } }),
    rd2Opt(9, 'legacyKernel', '--legacy-kernel', 'check', 'Legacy native kernel', '', 'native evaluator in double precision with per-thread force buffers, no active region'),
    rd2Opt(9, 'noRecover', '--no-recover', 'check', 'No recovery stages', '', 'do not run the recovery stages (stiffer backbone caps, centre guard) when the gate is not met after the default relaxation (docs/21)'),
    rd2Opt(9, 'polish', '--polish', 'int', 'Polish rounds', '0 (off)', 'up to N more native rounds at force tolerance 1.0 while E/nt improves by more than 0.003; kept only if the gate still holds', { min: 0, max: 1000, step: 1 }),
    rd2Opt(9, 'exportIters', '--export-iters', 'int', 'Export penalty iterations', '1500', 'iterations of the exporter penalty relaxation of unpaired nucleotides', { min: 1, max: 1000000, step: 1 }),
    rd2Opt(9, 'slowExport', '--slow-export', 'check', 'Slow export loop', '', 'previous (slower) exporter penalty loop'),
    // --- solver
    rd2Opt(10, 'solver', '--solver', 'select', 'Linear solver', 'block', 'LM linear solver: block (parallel multifrontal, default), eigen, legacy (the original reference path); the optional cholmod plugin is not in the browser build', { choices: ['block', 'eigen', 'legacy'] }),
    rd2Opt(10, 'verlet', '--verlet', 'check', 'Verlet pair lists', '', 'rebuild the pair lists when a node moved more than half the skin instead of every 5 iterations'),
    rd2Opt(10, 'chord', '--chord', 'int', 'Chord steps', '6', 'reuse a stale factorisation for this many iterations (1 = exact Newton every iteration)', { min: 1, max: 1000, step: 1 }),
    rd2Opt(10, 'gtol', '--gtol', 'num', 'Gradient tolerance', '1e-4', 'LM stops at max |gradient| below this (energy / length unit, rad)', { min: 0, max: 1 }),
    rd2Opt(10, 'etol', '--etol', 'num', 'Relative energy tolerance', '1e-9', 'LM stops when the relative energy decrease is below this', { min: 0, max: 1 }),
    rd2Opt(10, 'mu0', '--mu0', 'num', 'Initial damping mu0', '0.01', 'initial Levenberg-Marquardt damping mu0 (SolveOptions::mu0; not further described in the docs)', { min: 0, max: 1e6 }),
    rd2Opt(10, 'muUp', '--mu-up', 'num', 'Damping increase', '4', 'mu multiplier muUp (SolveOptions::muUp; not further described in the docs)', { min: 1, max: 1e6 }),
    rd2Opt(10, 'muDown', '--mu-down', 'num', 'Damping decrease', '3', 'mu divisor muDown (SolveOptions::muDown; not further described in the docs)', { min: 1, max: 1e6 }),
    rd2Opt(10, 'muUpBt', '--mu-up-bt', 'num', 'Damping after backtrack', '1', 'mu multiplier when a backtracked step was accepted', { min: 0, max: 1e6 }),
    rd2Opt(10, 'margin', '--margin', 'num', 'Hessian pattern margin', '0.05', 'repulsion pairs within dmin*(1+margin) enter the Hessian pattern', { min: 0, max: 10 }),
    rd2Opt(10, 'backtrack', '--backtrack', 'int', 'Backtracking steps', '3', 'halve the LM step up to this many times (same factorisation) before raising mu; 0 = off', { min: 0, max: 100, step: 1 }),
    rd2Opt(10, 'stagWindow', '--stag-window', 'int', 'Stagnation window', '25', 'stop when the energy fell by less than the stagnation tolerance (relative) over this many iterations', { min: 1, max: 100000, step: 1 }),
    rd2Opt(10, 'stagTol', '--stag-tol', 'num', 'Stagnation tolerance', '2e-3', 'relative energy decrease over the stagnation window below which the node stage stops', { min: 0, max: 1 }),
    // --- diagnostics and output
    rd2Opt(11, 'stop', '--route-only', 'flagsel', 'Stop early', 'full run', 'route-only: stop after the front end and print the route and the substructures; prepare-only: print the route, the notes and the design summary and stop. No structure is produced', { choices: ['route-only', 'prepare-only'], flags: { 'route-only': '--route-only', 'prepare-only': '--prepare-only' } }),
    rd2Opt(11, 'quiet', '--quiet', 'check', 'Quiet', '', 'only the summary (no stage lines in the log)'),
    rd2Opt(11, 'excReport', '--exc-report', 'check', 'Excluded volume report', '', 'print the excluded-volume energy of the result and its worst contacts'),
    rd2Opt(11, 'mlVerbose', '--ml-verbose', 'check', 'Verbose multilevel', '', 'log of the multilevel cascade'),
    rd2Opt(11, 'logdet', '--logdet', 'check', 'Log-determinant report', '', 'after the relaxation print the harmonic free energy terms (kT/2) ln det(H + eps I) of the Gauss-Newton Hessian (docs/08)'),
];

/** Pairs of options whose combination the engine resolves in a way the user may not expect: [option, other, what happens]. Both are passed as typed (so GUI = CLI); the hint says what the engine does. */
const RD2_CONFLICTS: [string, string, string][] = [
    ['noExc', 'exc', 'the later --no-exc wins: no excluded volume'],
    ['noMultilevel', 'multilevel', '--multilevel wins: the cascade stays on'],
    ['noXo', 'xoElement', 'the later --xo-element wins: the crossover element stays on'],
    ['legacy', 'subho', '--legacy ignores --subho and --multilevel'],
    ['legacy', 'multilevel', '--legacy ignores --subho and --multilevel'],
    ['stop', 'orientSearch', 'the run stops before the relaxation: nothing is searched'],
];

/** rd2_run options that exist but cannot be set from the browser, with the reason. */
const RD2_NATIVE_ONLY: [string, string][] = [
    ['--dat F', 'set by the page from the .dat file you choose together with an oxDNA .top'],
    ['--seq TOP DAT', 'needs a second oxDNA structure file; the browser front end passes none (the sequence is a placeholder, or that of the .top input)'],
    ['--template F, --params F', 'file paths: the template and the parameter set are embedded in the WebAssembly module'],
    ['--start-poses F, --from-poses F', 'pose tables are files; the browser run starts from the design itself'],
    ['--map F', 'file path (designs with several scaffolds / linker helices)'],
    ['--gpu', 'CUDA device: the WebAssembly build runs on the CPU (there is no WebGPU path)'],
    ['--keep-design, --dump-start, --write-poses, --write-forces, --dump-stages', 'write extra files next to the result; the browser run returns the .top, .dat and summary only'],
    ['--orient-only, --check-assembly', 'stop before the structure exists and write or check files; no structure to open'],
    ['--no-summary', 'the page reads the summary of the run'],
    ['--solver cholmod', 'optional plugin loaded with dlopen; not in the WebAssembly build'],
    ['--threads N', 'set in the Options block above'],
    ['--route, --infer-staples, --no-linkers, --no-native', 'set in the Options block above'],
    ['--version', 'prints the version only'],
];

function rd2AdvId(o: Rd2Opt, part?: string) { return 'rd2a_' + o.id + (part ? '_' + part : ''); }
function rd2AdvInput(id: string): HTMLInputElement | HTMLSelectElement | null { return document.getElementById(id) as any; }

/** Builds the Advanced properties groups (in #rd2AdvHost) from the table. Called once, when the window is created. */
function rd2AdvBuild() {
    const host = document.getElementById('rd2AdvHost');
    if (!host || host.childElementCount) return;
    const mk = (tag: string, cls?: string, text?: string): HTMLElement => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const acc = mk('div', 'accordion');
    acc.setAttribute('data-role', 'accordion');
    acc.setAttribute('data-one-frame', 'false');
    for (const g of RD2_GROUPS) {
        const frame = mk('div', 'frame');
        const heading = mk('div', 'heading', g);
        const content = mk('div', 'content');
        const row = mk('div', 'row');
        for (const o of RD2_OPTS.filter(x => x.group === g)) {
            const cell = mk('div', o.wide ? 'cell-12' : 'cell-6');
            const tip = `${o.flag}${o.def ? ' (default: ' + o.def + ')' : ''}: ${o.help}`;
            cell.title = tip;
            const lab = mk('label');
            lab.appendChild(document.createTextNode(o.label + ' '));
            lab.appendChild(mk('code', 'text-small', o.flag));
            const place = o.def ? 'default ' + o.def : '';
            if (o.kind === 'check') {
                const l = mk('label', 'checkbox');
                const inp = mk('input') as HTMLInputElement;
                inp.type = 'checkbox'; inp.id = rd2AdvId(o);
                l.appendChild(inp); l.appendChild(mk('span', 'check')); l.appendChild(mk('span', 'caption', `${o.label} (${o.flag})`));
                cell.appendChild(l);
            } else if (o.kind === 'select' || o.kind === 'flagsel') {
                cell.appendChild(lab);
                const s = mk('select') as HTMLSelectElement;
                s.id = rd2AdvId(o);
                s.setAttribute('data-role', 'select');
                const blank = mk('option', undefined, 'default' + (o.def ? ' (' + o.def + ')' : '')) as HTMLOptionElement;
                blank.value = '';
                s.appendChild(blank);
                for (const c of o.choices) { const op = mk('option', undefined, c) as HTMLOptionElement; op.value = c; s.appendChild(op); }
                cell.appendChild(s);
            } else if (o.kind === 'pair') {
                cell.appendChild(lab);
                const r2 = mk('div', 'row');
                for (const part of ['a', 'b']) {
                    const c2 = mk('div', 'cell-6');
                    const inp = mk('input') as HTMLInputElement;
                    inp.type = 'number'; inp.id = rd2AdvId(o, part); inp.min = String(o.min); inp.max = String(o.max); inp.step = '1';
                    inp.placeholder = part === 'a' ? 'iterations' : 'kept starts';
                    c2.appendChild(inp); r2.appendChild(c2);
                }
                cell.appendChild(r2);
            } else {
                cell.appendChild(lab);
                const inp = mk('input') as HTMLInputElement;
                inp.id = rd2AdvId(o);
                if (o.kind === 'int' || o.kind === 'num') {
                    inp.type = 'number'; inp.min = String(o.min); inp.max = String(o.max);
                    inp.step = o.kind === 'int' ? '1' : 'any';
                } else inp.type = 'text';
                inp.placeholder = place;
                cell.appendChild(inp);
            }
            const hint = mk('div', 'rd2-hint');
            hint.id = rd2AdvId(o, 'hint');
            cell.appendChild(hint);
            row.appendChild(cell);
        }
        content.appendChild(row);
        frame.appendChild(heading); frame.appendChild(content);
        acc.appendChild(frame);
    }
    host.appendChild(acc);
    // the options that cannot be set here, with the reason
    const nat = mk('div', 'mt-2');
    nat.appendChild(mk('h5', undefined, 'Native rd2_run only (not available in the browser)'));
    for (const [flag, why] of RD2_NATIVE_ONLY) {
        const item = mk('div', 'rd2-native text-small');
        item.appendChild(mk('code', undefined, flag));
        item.appendChild(document.createTextNode(' ' + why));
        nat.appendChild(item);
    }
    host.appendChild(nat);
    const pane = document.getElementById('rdPane2');
    if (pane && !(pane as any).__rd2Wired) {
        (pane as any).__rd2Wired = true;
        pane.addEventListener('input', rd2AdvChanged);
        pane.addEventListener('change', rd2AdvChanged);
    }
}

interface Rd2AdvState {
    extra: string[];
    fields: { lattice?: 'square' | 'honeycomb'; seed?: number; nativeIters?: number };
    problems: { id: string; msg: string }[];     // invalid entries: ignored
    notes: { id: string; msg: string }[];        // valid entries that interact
    set: number;                                 // options that are passed
}

/** Reads and checks every advanced field. Nothing invalid reaches the command line. */
function rd2AdvRead(): Rd2AdvState {
    const st: Rd2AdvState = { extra: [], fields: {}, problems: [], notes: [], set: 0 };
    const active: { [id: string]: boolean } = {};
    const parseNum = (s: string, o: Rd2Opt, integer: boolean): { v?: number; err?: string } => {
        s = s.trim();
        if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return { err: 'not a number' };
        const v = Number(s);
        if (!isFinite(v)) return { err: 'not a number' };
        if (integer && !Number.isInteger(v)) return { err: 'must be a whole number' };
        if (o.min !== undefined && v < o.min) return { err: 'must be at least ' + o.min };
        if (o.max !== undefined && v > o.max) return { err: 'must be at most ' + o.max };
        return { v };
    };
    for (const o of RD2_OPTS) {
        const el = rd2AdvInput(rd2AdvId(o, o.kind === 'pair' ? 'a' : ''));
        if (!el) continue;
        let args: string[] = null, err = '';
        if (o.kind === 'check') {
            if ((el as HTMLInputElement).checked) args = [o.flag];
        } else if (o.kind === 'select') {
            if (el.value) { if (o.choices.indexOf(el.value) < 0) err = 'not one of ' + o.choices.join(', '); else args = [o.flag, el.value]; }
        } else if (o.kind === 'flagsel') {
            if (el.value) { if (o.choices.indexOf(el.value) < 0) err = 'not one of ' + o.choices.join(', '); else args = [o.flags[el.value]]; }
        } else if (o.kind === 'int' || o.kind === 'num') {
            const t = el.value.trim();
            if (t) { const r = parseNum(t, o, o.kind === 'int'); if (r.err) err = r.err; else args = [o.flag, String(r.v)]; }
        } else if (o.kind === 'ints' || o.kind === 'nums') {
            const t = el.value.trim();
            if (t) {
                const parts = t.split(',').map(x => x.trim());
                const vals = parts.map(p => parseNum(p, o, o.kind === 'ints'));
                const bad = vals.find(v => v.err);
                if (bad) err = 'comma separated list: ' + bad.err; else args = [o.flag, vals.map(v => String(v.v)).join(',')];
            }
        } else if (o.kind === 'pair') {
            const a = rd2AdvInput(rd2AdvId(o, 'a')), b = rd2AdvInput(rd2AdvId(o, 'b'));
            const ta = a ? a.value.trim() : '', tb = b ? b.value.trim() : '';
            if (ta || tb) {
                const ra = ta ? parseNum(ta, o, true) : { err: 'both values are needed' }, rb = tb ? parseNum(tb, o, true) : { err: 'both values are needed' };
                if (ra.err || rb.err) err = ra.err || rb.err; else args = [o.flag, String(ra.v), String(rb.v)];
            }
        }
        const hint = document.getElementById(rd2AdvId(o, 'hint'));
        const bad = !!err;
        if (bad) st.problems.push({ id: o.id, msg: err });
        if (hint) { hint.textContent = bad ? 'Ignored: ' + err + '.' : ''; hint.classList.toggle('rd2-bad', bad); }
        el.classList.toggle('rd2-invalid', bad);
        if (!args) continue;
        active[o.id] = true;
        st.set++;
        if (o.field === 'lattice') st.fields.lattice = el.value as any;
        else if (o.field === 'seed') st.fields.seed = Number(args[1]);
        else if (o.field === 'nativeIters') st.fields.nativeIters = Number(args[1]);
        else st.extra.push(...args);
    }
    // clear the interaction notes, then set those that apply
    for (const [a, b, what] of RD2_CONFLICTS) {
        const oa = RD2_OPTS.filter(x => x.id === a)[0];
        const hint = document.getElementById(rd2AdvId(oa, 'hint'));
        if (active[a] && active[b] && hint && !hint.textContent) { hint.textContent = 'Note: with --' + b.replace(/([A-Z])/g, m => '-' + m.toLowerCase()) + ' set too, ' + what + '.'; hint.classList.remove('rd2-bad'); st.notes.push({ id: a, msg: what }); }
    }
    return st;
}

/** The options object of the bridge: the basic controls plus the advanced fields. */
function rd2Options(): Rd2Options {
    const threads = parseInt(rd2El<HTMLInputElement>('rd2Threads').value) || 1;
    const adv = rd2AdvRead();
    return {
        route: rd2El<HTMLSelectElement>('rd2Route').value as Rd2Options['route'],
        inferStaples: rd2El<HTMLSelectElement>('rd2Infer').value as Rd2Options['inferStaples'],
        linkers: rd2El<HTMLSelectElement>('rd2Linkers').value as Rd2Options['linkers'],
        native: rd2El<HTMLInputElement>('rd2Native').checked,
        threads,
        ...(adv.fields.lattice ? { lattice: adv.fields.lattice } : {}),
        ...(adv.fields.seed !== undefined ? { seed: adv.fields.seed } : {}),
        ...(adv.fields.nativeIters !== undefined ? { nativeIters: adv.fields.nativeIters } : {}),
        ...(adv.extra.length ? { extra: adv.extra } : {}),
    };
}

/** True when an advanced option stops the run before a structure exists (--route-only, --prepare-only). */
function rd2StopsEarly(): boolean {
    const el = rd2AdvInput('rd2a_stop');
    return !!el && !!el.value;
}

function rd2Quote(a: string): string { return /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'"; }

/**
 * The command line that the run will give to rd2_run: the arguments are made by Rd2Api.buildArgs of wasm/rigiddna2/rd2_api.js, the very function the worker
 * runs, from the very options object of the run, so the preview cannot drift from what is executed.
 */
function rd2CommandLine(): { args: string[]; text: string; error?: string } {
    const name = rd2Design ? rd2Design.name : 'design.json';
    const api = (window as any).Rd2Api;
    if (!api) return { args: [], text: '', error: 'the engine script (rd2_api.js) is not loaded yet' };
    try {
        const o = rd2Options();
        o.threads = Math.max(1, Math.min(o.threads || 1, Rd2Engine.maxUsableThreads()));
        const args: string[] = api.buildArgs(o, api.extensionOf(name));
        if (rd2Design && rd2Design.dat !== undefined) args.push('--dat', rd2Design.name.replace(/\.[^.]+$/, '') + '.dat');
        const prefix = name.replace(/\.[^.]+$/, '') + '_relaxed';
        return { args, text: ['rd2_run', name, prefix, ...args].map(rd2Quote).join(' ') };
    } catch (e) {
        return { args: [], text: '', error: String((e && e.message) || e) };
    }
}

/** Refreshes the hints, the count and the command line preview. */
function rd2AdvChanged() {
    const st = rd2AdvRead();
    const cmd = rd2CommandLine();
    const pre = document.getElementById('rd2Cmd');
    if (pre) { pre.textContent = cmd.error ? 'unavailable: ' + cmd.error : cmd.text; pre.setAttribute('data-args', cmd.args.join('\n')); }
    const cnt = document.getElementById('rd2AdvCount');
    if (cnt) cnt.textContent = st.set ? `(${st.set} set${st.problems.length ? ', ' + st.problems.length + ' ignored' : ''})` : (st.problems.length ? `(${st.problems.length} ignored)` : '');
    const sum = document.getElementById('rd2AdvProblems');
    if (sum) sum.textContent = st.problems.length ? `${st.problems.length} entr${st.problems.length === 1 ? 'y is' : 'ies are'} invalid and will not be passed to the engine (marked in red).` : '';
}

/** "Reset advanced" button: every advanced field back to blank (engine default). */
function rd2AdvReset() {
    for (const o of RD2_OPTS) {
        for (const part of o.kind === 'pair' ? ['a', 'b'] : ['']) {
            const el = rd2AdvInput(rd2AdvId(o, part));
            if (!el) continue;
            if (o.kind === 'check') (el as HTMLInputElement).checked = false; else el.value = '';
            if (o.kind === 'select' || o.kind === 'flagsel') { try { (window as any).Metro.getPlugin(el, 'select').val(''); } catch (e) { /* plain select */ } }
        }
    }
    rd2AdvChanged();
}

/** "Copy" button of the command line preview. */
async function rd2CopyCommand() {
    const t = document.getElementById('rd2Cmd').textContent;
    try { await navigator.clipboard.writeText(t); notify('Command line copied.'); } catch (e) { notify('Could not copy: select the text and copy it by hand.', 'warn'); }
}

/** "Relax" button. */
async function rd2Run() {
    if (!rd2Design || rd2Running) return;
    rd2El('rd2Log').textContent = '';
    rd2El('rd2Summary').innerHTML = '';
    const bar = rd2El<HTMLProgressElement>('rd2Bar'), label = rd2El('rd2Stage');
    bar.value = 0;
    rd2CoarseStep = 0; rd2CoarseSteps = 1;
    rd2SetRunning(true);
    const t0 = performance.now();
    try {
        label.textContent = 'Starting the engine...';
        const opts = rd2Options();   // the same options as the command line preview
        const cmd = rd2CommandLine();
        if (cmd.text) rd2Log('$ ' + cmd.text);
        const r = await rd2Engine.run(rd2Design, opts, (p) => {
            bar.value = rd2Fraction(p);
            label.textContent = rd2StageLabel(p);
        }, (line) => rd2Log(line));
        bar.value = 1;
        label.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s (${r.variant === 'mt' ? r.threads + ' threads' : 'single thread'}).`;
        rd2ShowSummary(r);
        if ((!r.top || !r.dat) && rd2StopsEarly() && r.rc !== 3) { label.textContent = 'Stopped after the front end, as asked (see the log).'; return; }
        if (!r.top || !r.dat) { notify('rigidDNA2 produced no structure: ' + (r.log.split('\n').filter(l => l.startsWith('ERROR')).pop() || 'see the log'), 'alert'); return; }
        if (r.rc !== 0) notify('The relaxed structure was written but did not meet the safety gate (see the summary).', 'warn');
        const base = rd2Design.name.replace(/\.[^.]+$/, '');
        handleFiles([new File([r.top], base + '.top'), new File([r.dat], base + '.dat')]);
    } catch (e) {
        label.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Failed: ' + e.message;
        if (e.message !== 'cancelled') notify('rigidDNA2 failed: ' + e.message, 'alert');
    } finally {
        rd2SetRunning(false);
    }
}

/** "Cancel" button: stops the worker. */
function rd2Cancel() { if (rd2Running) rd2Engine.cancel(); }

/** Poly-T gap-linker nucleotides the lattice route added (the engine reports them in its notes), so the exported count can be compared with the design. */
function rd2LinkerText(s: any): string {
    const m = /(\d+) links? longer than [\d.]+ oxDNA units get (\d+) linker nucleotides/.exec((s.notes || []).join('\n'));
    return m ? `<b>${m[2]} poly-T nucleotides added</b> in ${m[1]} links (not in the design; choose "None" under Gap-linker nucleotides to export exactly the designed nucleotides)` : 'none (the nucleotides are the designed ones)';
}

function rd2ShowSummary(r: Rd2Result) {
    const s = r.summary;
    if (!s) return;
    const row = (k: string, v: any) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    rd2El('rd2Summary').innerHTML = '<table class="table compact row-hover">' +
        row('route', `${s.route} <span class="text-muted text-small">(${s.route_reason})</span>`) +
        row('nucleotides', s.nucleotides) +
        row('gap linkers', rd2LinkerText(s)) +
        row('E / nt (oxDNA2)', s.native_energy_per_nt !== undefined ? s.native_energy_per_nt.toFixed(4) : 'native relaxation off') +
        row('safety gate', s.gate_met ? 'met' : '<b>not met</b>: ' + s.gate_message) +
        row('time', `${s.seconds_total.toFixed(1)} s in the engine, ${r.seconds.toFixed(1)} s with I/O`) + '</table>';
}

/** Registers coi-serviceworker.js (adds COOP/COEP in the page's name) and reloads: makes the page cross-origin isolated when the server sends no such headers. */
async function rd2EnableIsolation() {
    if (!('serviceWorker' in navigator)) { notify('Service workers are not available here.', 'alert'); return; }
    try {
        await navigator.serviceWorker.register('coi-serviceworker.js');
        await navigator.serviceWorker.ready;
        // the reload must be answered by the worker: wait until it controls the page (it claims its clients on activation)
        if (!navigator.serviceWorker.controller) {
            await new Promise<void>(resolve => {
                navigator.serviceWorker.addEventListener('controllerchange', () => resolve());
                setTimeout(resolve, 3000);
            });
        }
        window.location.reload();
    } catch (e) {
        notify('Could not register the service worker: ' + e.message, 'alert');
    }
}
