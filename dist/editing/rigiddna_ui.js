/**
 * rigiddna_ui.ts
 *
 * Wires the RigidDnaBridge WASM engines (rigiddna_bridge.ts) into the live
 * scene: exporting the current structure to oxDNA text (with a cluster_id
 * column derived from whichever clustering source the user picked),
 * running the WASM engine, and writing the relaxed positions back onto the
 * live BasicElements. UI glue for windows/rigidDNAWindow.html.
 */
// Building block for a "cluster source" -- one of the three the rigidDNA
// window offers: rigidDNA's own geometric auto-clusterer, oxView's
// existing DBSCAN clusterer, or the user's manual per-selection clusters.
// All three end up as element.clusterId assignments on the live scene, so
// the rest of the pipeline (export/relax/apply) doesn't need to know which
// one produced them.
/**
 * Every element not currently assigned a clusterId (DBSCAN "noise", or
 * nothing run yet) becomes its own singleton rigid cluster -- free to move
 * independently, rather than silently lumped together. Returns cluster ids
 * in the same order newElementIDs iterates (matches the .top/.dat row
 * order produced by makeTopFile/makeDatFile).
 */
function resolveRigidDnaClusterIds(newElementIDs) {
    let maxId = -1;
    newElementIDs.forEach((_id, e) => {
        if (typeof e.clusterId === 'number' && e.clusterId >= 0)
            maxId = Math.max(maxId, e.clusterId);
    });
    let nextFreeId = maxId + 1;
    const result = [];
    newElementIDs.forEach((_id, e) => {
        result.push((typeof e.clusterId === 'number' && e.clusterId >= 0) ? e.clusterId : nextFreeId++);
    });
    return result;
}
/**
 * Exports the whole live scene (all loaded systems, like "Download Output
 * Files" does) to oxDNA topology + configuration text, with the topology's
 * cluster_id column filled in from each element's current clusterId (see
 * resolveRigidDnaClusterIds). Returns the text plus the id map needed to
 * apply a relaxed configuration back onto the right elements afterward.
 */
function exportSceneForRigidDna() {
    const [newElementIDs, newStrandIDs, counts, gsSubtypes] = getNewIds(false);
    const { file: plainTop } = makeTopFile('rigiddna', newElementIDs, newStrandIDs, gsSubtypes, counts, false);
    const { file: datText } = makeDatFile('rigiddna', newElementIDs);
    const clusterIds = resolveRigidDnaClusterIds(newElementIDs);
    const numClusters = clusterIds.length > 0 ? Math.max(...clusterIds) + 1 : 0;
    const lines = plainTop.split('\n');
    const header = lines[0].split(/\s+/);
    lines[0] = [header[0], header[1], numClusters].join(' ');
    for (let i = 1; i < lines.length; i++) {
        const clusterId = clusterIds[i - 1];
        if (clusterId !== undefined && lines[i].length > 0)
            lines[i] = `${lines[i]} ${clusterId}`;
    }
    return { topText: lines.join('\n'), datText, newElementIDs };
}
/**
 * Writes a relaxed configuration (rigid_body_sim's last_conf.dat text) back
 * onto the live scene, using the same newElementIDs map exportSceneForRigidDna
 * produced -- so row i of the conf lands on exactly the element that row i
 * of the exported topology/configuration described, regardless of how many
 * systems are loaded or in what order.
 */
function applyRigidDnaConf(confText, newElementIDs) {
    const byId = new Map();
    newElementIDs.forEach((id, el) => byId.set(id, el));
    const dataLines = confText.split('\n').slice(3); // skip "t = / b = / E =" header
    const touchedSystems = new Set();
    for (let i = 0; i < byId.size; i++) {
        if (!dataLines[i])
            break;
        const el = byId.get(i);
        if (!el)
            continue;
        el.calcPositionsFromConfLine(dataLines[i].split(/\s+/));
        touchedSystems.add(el.strand.system);
    }
    touchedSystems.forEach(sys => sys.callAllUpdates());
    document.dispatchEvent(new Event('nextConfigLoaded'));
}
/** Reads a number input, treating an empty/unparseable value as "not set" (undefined) rather than NaN/0 -- for optional fields whose absence should leave the underlying C++ default in place. */
function rigidDnaOptionalNumber(id) {
    const el = document.getElementById(id);
    if (!el || el.value === '')
        return undefined;
    const n = parseFloat(el.value);
    return isNaN(n) ? undefined : n;
}
/**
 * Gathers every rigidDNA relax parameter from the window's form fields into
 * a RigidDnaRelaxOptions, matching every key RigidBodySim.cpp's readInput()
 * accepts (see rigiddna_bridge.ts's doc comments and the parameters
 * reference at https://subhajit-roy-partho.github.io/rigidDNA/parameters.html).
 * Fields left at their default/blank value are simply omitted, so the C++
 * side's own defaults apply untouched -- e.g. leaving "Bond distance" blank
 * reproduces today's cluster_size-dependent default exactly.
 */
function collectRigidDnaRelaxOptions() {
    const opts = {
        steps: view.getInputNumber('rigidDnaSteps'),
        dt: view.getInputNumber('rigidDnaDt'),
        k: view.getInputNumber('rigidDnaK'),
        b: view.getInputNumber('rigidDnaB'),
        repulsion: view.getInputNumber('rigidDnaRepulsion'),
        repulsionOffset: view.getInputNumber('rigidDnaRepulsionOffset'),
        recluster: view.getInputBool('rigidDnaRecluster'),
        clusterMode: document.getElementById('rigidDnaClusterMode').value,
        bundleSize: view.getInputNumber('rigidDnaBundleSize'),
        clusterAngleDeg: view.getInputNumber('rigidDnaAngleDeg'),
        clusterMaxMergeDist: view.getInputNumber('rigidDnaMaxMergeDist'),
    };
    const breakLength = rigidDnaOptionalNumber('rigidDnaBreakLength');
    if (breakLength)
        opts.breakLength = breakLength;
    const bondDistance = rigidDnaOptionalNumber('rigidDnaBondDistance');
    if (bondDistance !== undefined) {
        opts.bondDistance = bondDistance;
        const bondDistanceEnd = rigidDnaOptionalNumber('rigidDnaBondDistanceEnd');
        if (bondDistanceEnd !== undefined)
            opts.bondDistanceEnd = bondDistanceEnd;
    }
    if (view.getInputBool('rigidDnaKRampEnable')) {
        opts.kStart = view.getInputNumber('rigidDnaKStart');
        opts.kIncrement = view.getInputNumber('rigidDnaKIncrement');
    }
    if (view.getInputBool('rigidDnaPlanar')) {
        opts.planar = true;
        const nx = rigidDnaOptionalNumber('rigidDnaPlaneNormalX');
        const ny = rigidDnaOptionalNumber('rigidDnaPlaneNormalY');
        const nz = rigidDnaOptionalNumber('rigidDnaPlaneNormalZ');
        if (nx !== undefined && ny !== undefined && nz !== undefined)
            opts.planeNormal = [nx, ny, nz];
    }
    if (view.getInputBool('rigidDnaVolumeExclusion')) {
        opts.volumeExclusion = true;
        opts.volumeExclusionType = parseInt(document.getElementById('rigidDnaVolumeExclusionType').value);
        opts.volumeExclusionCutoff = view.getInputNumber('rigidDnaVolumeExclusionCutoff');
        opts.volumeExclusionK = view.getInputNumber('rigidDnaVolumeExclusionK');
        opts.volumeExclusionInterval = view.getInputNumber('rigidDnaVolumeExclusionInterval');
        const start = rigidDnaOptionalNumber('rigidDnaVolumeExclusionStart');
        if (start !== undefined)
            opts.volumeExclusionStart = start;
    }
    const energyLogInterval = rigidDnaOptionalNumber('rigidDnaEnergyLogInterval');
    if (energyLogInterval) {
        opts.energyLogInterval = energyLogInterval;
        const file = view.getInputValue('rigidDnaEnergyLogFile');
        if (file)
            opts.energyLogFile = file;
    }
    return opts;
}
/**
 * Which of the chosen options force a single, continuous (non-chunked) run.
 *
 * RigidBodySim.cpp's initRigidBodies() resets cluster momentum, k_spring_current
 * (to k_spring_start, or k_spring if no ramp), r0_current, and the ramp/
 * volume-exclusion timing (bond_distance_ramp_end_step, volume_exclusion_start)
 * EVERY time it runs -- all derived from the `steps` value of THAT run. Our
 * chunked live-preview re-invokes rigid_body_sim fresh for every chunk with
 * steps=chunkSize, so any ramp tied to the GLOBAL step count would incorrectly
 * restart from scratch at the start of every chunk instead of continuing
 * smoothly across the whole run (e.g. a bond_distance ramp meant to finish at
 * global step 2000 would instead finish at the end of chunk 1, chunk 2, ...).
 *
 * Rather than reimplementing that ramp math on the JS side (fragile, and the
 * volume_exclusion_start step-count gating inside stepPhysics() -- current_step
 * being chunk-local, not global -- makes an exact reproduction awkward, see
 * the task notes this was written against), we take the simpler, safer route:
 * fall back to today's single non-chunked call whenever any of these are in
 * play, and only use chunked live-preview for the common case (fixed k, fixed
 * bond_distance, no volume exclusion, no in-relax reclustering). Momentum
 * being reset to zero at each chunk boundary in the *chunked* path is an
 * accepted, intentional approximation for these non-ramping cases -- this is
 * a heavily-damped relaxation, not a real dynamics trajectory, and restarting
 * each chunk "at rest" converges to essentially the same relaxed structure.
 */
function rigidDnaRequiresSingleRun(opts) {
    const reasons = [];
    if (opts.kIncrement)
        reasons.push('spring ramping (k_start/k_increment)');
    if (opts.bondDistanceEnd !== undefined && opts.bondDistance !== undefined && opts.bondDistanceEnd !== opts.bondDistance) {
        reasons.push('bond_distance ramp');
    }
    if (opts.volumeExclusion)
        reasons.push('volume exclusion');
    if (opts.recluster)
        reasons.push('recluster (geometry reclustering inside the relax step)');
    return reasons;
}
function rigidDnaLog(line) {
    const el = document.getElementById('rigidDnaLog');
    if (!el)
        return;
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
}
function rigidDnaClusterSummary() {
    let n = 0;
    const ids = new Set();
    elements.forEach(e => {
        if (typeof e.clusterId === 'number' && e.clusterId >= 0) {
            n++;
            ids.add(e.clusterId);
        }
    });
    const status = document.getElementById('rigidDnaClusterStatus');
    const msg = `${ids.size} cluster(s) covering ${n} of ${elements.size} particle(s) (uncovered particles run as singleton clusters).`;
    if (status)
        status.textContent = msg;
    return msg;
}
/** oncreate callback passed to view.toggleWindow('rigidDNAWindow', ...) */
function initRigidDnaWindow() {
    rigidDnaClusterSummary();
}
/** "Auto -- rigidDNA (helix geometry)" button in the rigidDNA window */
async function runRigidDnaAutoCluster() {
    if (elements.size === 0) {
        notify('Load a structure first.');
        return;
    }
    const angleDeg = view.getInputNumber('rigidDnaAngleDeg');
    const maxMergeDist = view.getInputNumber('rigidDnaMaxMergeDist');
    const clusterMode = document.getElementById('rigidDnaClusterMode').value;
    const bundleSize = view.getInputNumber('rigidDnaBundleSize');
    const breakLength = rigidDnaOptionalNumber('rigidDnaBreakLength') ?? 0;
    const log = document.getElementById('rigidDnaLog');
    if (log)
        log.textContent = '';
    notify('Running rigidDNA auto-clustering (helix geometry)...');
    const { topText, datText, newElementIDs } = exportSceneForRigidDna();
    const result = await RigidDnaBridge.computeClusters(topText, datText, {
        angleDeg, maxMergeDist, clusterMode, bundleSize, breakLength, onLog: rigidDnaLog,
    });
    if (!result.ok) {
        notify(`rigidDNA clustering failed: ${result.error || 'unknown error'}`, 'alert');
        return;
    }
    // result.clusteredTop is in rigidDNA's 5-column format (strand type n3 n5 cluster_id);
    // row order matches newElementIDs, same as the topology we sent in.
    const byId = new Map();
    newElementIDs.forEach((id, el) => byId.set(id, el));
    const lines = result.clusteredTop.split('\n').slice(1);
    // The WASM auto-clusterer numbers clusters 0-based, but every native
    // oxView consumer is 1-based (DBSCAN starts at ++clusterCounter, .oxview
    // I/O and UNF export index groups as clusterId-1). Normalize here, at the
    // import boundary, so the rest of the pipeline keeps a single convention.
    let maxImportedId = clusterCounter;
    lines.forEach((line, i) => {
        if (!line)
            return;
        const cols = line.split(/\s+/);
        const clusterId = parseInt(cols[cols.length - 1]);
        const el = byId.get(i);
        if (el && !isNaN(clusterId)) {
            el.clusterId = clusterId + 1;
            if (el.clusterId > maxImportedId)
                maxImportedId = el.clusterId;
        }
    });
    // Keep clusterCounter covering the imported ids: identifyClusters() sizes
    // its UNF group array from clusterCounter, so a stale (smaller) counter
    // would index out of bounds and crash the export with a TypeError.
    clusterCounter = maxImportedId;
    view.coloringMode.set('Cluster');
    notify(rigidDnaClusterSummary());
}
/** "Auto -- oxView DBSCAN" button: reuses the existing, already-shipped clusterer */
function runRigidDnaOxViewCluster() {
    const minPts = view.getInputNumber('rigidDnaMinPts');
    const epsilon = view.getInputNumber('rigidDnaEpsilon');
    view.longCalculation(() => { dbscan(minPts, epsilon); }, 'Calculating clusters, please be patient...', () => { view.coloringMode.set('Cluster'); notify(rigidDnaClusterSummary()); });
}
/** "Add current selection as one cluster" button (manual mode) */
function runRigidDnaManualCluster() {
    selectionToCluster(); // existing function from clustering.ts
    rigidDnaClusterSummary();
}
/** "Clear all clusters" button */
function runRigidDnaClearClusters() {
    clearClusters(); // existing function from clustering.ts
    rigidDnaClusterSummary();
}
/**
 * Runs the relaxation as a sequence of short chunks against the live scene,
 * so the user can watch the structure move instead of seeing nothing until
 * the whole run finishes. Each chunk is an independent rigid_body_sim
 * invocation (steps=chunkSize) whose output configuration is applied to the
 * scene immediately and fed back in as the next chunk's input configuration
 * -- see rigidDnaRequiresSingleRun()'s doc comment for why this is only safe
 * when no ramping/volume-exclusion/in-relax-reclustering option is active
 * (the caller must have already checked that).
 *
 * Chunk size is adaptive rather than a fixed guess: after each chunk we know
 * exactly how many wall-clock ms that many steps took on this machine for
 * this structure, so we rescale the next chunk's step count to target
 * ~220ms -- comfortably inside the "feels responsive" 150-300ms window the
 * task called for, regardless of structure size or machine speed.
 */
async function runRigidDnaRelaxChunked(topText, datText, newElementIDs, opts, totalSteps) {
    const TARGET_CHUNK_MS = 220;
    let chunkSize = Math.max(1, Math.min(50, totalSteps)); // conservative first probe, adapted immediately after
    let stepsDone = 0;
    let currentDat = datText;
    while (stepsDone < totalSteps) {
        const chunkSteps = Math.min(chunkSize, totalSteps - stepsDone);
        const t0 = performance.now();
        const result = await RigidDnaBridge.relax(topText, currentDat, {
            ...opts,
            steps: chunkSteps,
            recluster: false,
            onLog: () => { }, // suppress this chunk's own engine boilerplate (topology/cluster summary would repeat every chunk); we log our own progress line below instead
        });
        const elapsedMs = performance.now() - t0;
        if (!result.ok || !result.lastConf) {
            notify(`rigidDNA relaxation failed: ${result.error || 'unknown error'}`, 'alert');
            return false;
        }
        applyRigidDnaConf(result.lastConf, newElementIDs);
        stepsDone += chunkSteps;
        rigidDnaLog(`Step ${stepsDone}/${totalSteps}...`);
        currentDat = result.lastConf;
        if (elapsedMs > 0 && stepsDone < totalSteps) {
            const stepsPerMs = chunkSteps / elapsedMs;
            chunkSize = Math.max(5, Math.min(5000, Math.round(stepsPerMs * TARGET_CHUNK_MS)));
        }
        // Yield to the browser so it actually repaints the scene update above
        // before the next (synchronous, potentially blocking) chunk runs.
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
    }
    return true;
}
/** "Run rigidDNA Relaxation" button */
async function runRigidDnaRelax() {
    if (elements.size === 0) {
        notify('Load a structure first.');
        return;
    }
    const log = document.getElementById('rigidDnaLog');
    if (log)
        log.textContent = '';
    const opts = collectRigidDnaRelaxOptions();
    const totalSteps = opts.steps ?? 2000;
    const { topText, datText, newElementIDs } = exportSceneForRigidDna();
    const livePreviewRequested = view.getInputBool('rigidDnaLivePreview');
    const singleRunReasons = rigidDnaRequiresSingleRun(opts);
    if (livePreviewRequested && singleRunReasons.length === 0) {
        notify('Running rigidDNA relaxation with live preview (WASM, in your browser)...');
        await runRigidDnaRelaxChunked(topText, datText, newElementIDs, opts, totalSteps);
        notify('rigidDNA relaxation complete -- structure updated.');
        return;
    }
    if (livePreviewRequested && singleRunReasons.length > 0) {
        rigidDnaLog(`Live preview disabled for this run (${singleRunReasons.join(', ')} need${singleRunReasons.length === 1 ? 's' : ''} a single continuous pass to stay physically correct) -- running all ${totalSteps} steps in one shot...`);
    }
    notify('Running rigidDNA relaxation -- this runs entirely in your browser (WASM), no server round-trip...');
    const result = await RigidDnaBridge.relax(topText, datText, { ...opts, onLog: rigidDnaLog });
    if (!result.ok || !result.lastConf) {
        notify(`rigidDNA relaxation failed: ${result.error || 'unknown error'}`, 'alert');
        return;
    }
    applyRigidDnaConf(result.lastConf, newElementIDs);
    notify('rigidDNA relaxation complete -- structure updated.');
}
