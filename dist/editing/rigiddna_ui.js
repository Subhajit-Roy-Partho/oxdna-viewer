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
    const clusterMode = document.getElementById('rigidDnaClusterMode').value;
    const log = document.getElementById('rigidDnaLog');
    if (log)
        log.textContent = '';
    notify('Running rigidDNA auto-clustering (helix geometry)...');
    const { topText, datText, newElementIDs } = exportSceneForRigidDna();
    const result = await RigidDnaBridge.computeClusters(topText, datText, { angleDeg, clusterMode, onLog: rigidDnaLog });
    if (!result.ok) {
        notify(`rigidDNA clustering failed: ${result.error || 'unknown error'}`, 'alert');
        return;
    }
    // result.clusteredTop is in rigidDNA's 5-column format (strand type n3 n5 cluster_id);
    // row order matches newElementIDs, same as the topology we sent in.
    const byId = new Map();
    newElementIDs.forEach((id, el) => byId.set(id, el));
    const lines = result.clusteredTop.split('\n').slice(1);
    lines.forEach((line, i) => {
        if (!line)
            return;
        const cols = line.split(/\s+/);
        const clusterId = parseInt(cols[cols.length - 1]);
        const el = byId.get(i);
        if (el && !isNaN(clusterId))
            el.clusterId = clusterId;
    });
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
/** "Run rigidDNA Relaxation" button */
async function runRigidDnaRelax() {
    if (elements.size === 0) {
        notify('Load a structure first.');
        return;
    }
    const log = document.getElementById('rigidDnaLog');
    if (log)
        log.textContent = '';
    notify('Running rigidDNA relaxation -- this runs entirely in your browser (WASM), no server round-trip...');
    const { topText, datText, newElementIDs } = exportSceneForRigidDna();
    const result = await RigidDnaBridge.relax(topText, datText, {
        steps: view.getInputNumber('rigidDnaSteps'),
        dt: view.getInputNumber('rigidDnaDt'),
        k: view.getInputNumber('rigidDnaK'),
        b: view.getInputNumber('rigidDnaB'),
        repulsion: view.getInputNumber('rigidDnaRepulsion'),
        recluster: false,
        onLog: rigidDnaLog,
    });
    if (!result.ok || !result.lastConf) {
        notify(`rigidDNA relaxation failed: ${result.error || 'unknown error'}`, 'alert');
        return;
    }
    applyRigidDnaConf(result.lastConf, newElementIDs);
    notify('rigidDNA relaxation complete -- structure updated.');
}
