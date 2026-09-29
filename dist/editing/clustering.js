/**
 * Clear clusters and reset the cluster counter
 */
function clearClusters() {
    clusterCounter = 0; // Cluster counter
    clusterNames = {}; // Cluster id -> user label (rename UI + .oxview persistence)
    elements.forEach(element => {
        delete element.clusterId;
    });
    view.coloringMode.set("Strand"); // Then color by strand
    refreshClusterList();
}
/**
 * User-assigned labels for native (numeric) clusters. Keyed by cluster id.
 * The default display label for an unlabeled cluster is `Cluster <id>`.
 * Persisted in .oxview files as a top-level `clusterNames` map (old readers
 * ignore the unknown field; new readers handle its absence).
 */
var clusterNames = {};
/** Display label for a cluster id (user label, or `Cluster <id>` fallback). */
function getClusterLabel(id) {
    return clusterNames[id] || `Cluster ${id}`;
}
/**
 * Rename a cluster. The new name must be non-empty and not already used by
 * another cluster. Returns true on success.
 */
function renameCluster(id, name) {
    name = (name || "").trim();
    if (!name) {
        notify("Cluster name cannot be empty", "warning");
        return false;
    }
    for (const other of Object.keys(clusterNames)) {
        if (parseInt(other) !== id && clusterNames[other] === name) {
            notify(`Another cluster is already named "${name}"`, "warning");
            return false;
        }
    }
    clusterNames[id] = name;
    refreshClusterList();
    render();
    return true;
}
/** Every cluster currently present in the scene, with label + size. */
function listClusters() {
    const sizes = new Map();
    elements.forEach(e => {
        if (typeof e.clusterId === 'number' && e.clusterId >= 0) {
            sizes.set(e.clusterId, (sizes.get(e.clusterId) || 0) + 1);
        }
    });
    return Array.from(sizes.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([id, size]) => ({ id, label: getClusterLabel(id), size }));
}
/**
 * Select every element of one cluster (replaces the selection unless
 * keepPrev is set). Works from the clustering window list and from code.
 */
function selectCluster(id, keepPrev) {
    const elems = [];
    elements.forEach(e => {
        if (e.clusterId === id)
            elems.push(e);
    });
    if (elems.length === 0) {
        notify(`Cluster ${id} (${getClusterLabel(id)}) is empty or does not exist`, "warning");
        return;
    }
    api.selectElements(elems, keepPrev);
}
/**
 * Rebuild the cluster list in the clustering window (label inputs + select
 * buttons). No-op when the window is not open. Called after every mutation
 * that changes cluster membership or labels.
 */
function refreshClusterList() {
    const list = document.getElementById("clusterList");
    if (!list)
        return;
    const clusters = listClusters();
    list.innerHTML = "";
    if (clusters.length === 0) {
        list.innerHTML = `<p class="text-muted text-small">No clusters yet.</p>`;
        return;
    }
    clusters.forEach(c => {
        const row = document.createElement("div");
        row.className = "group";
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.alignItems = "center";
        const badge = document.createElement("span");
        badge.textContent = `#${c.id} · ${c.size} nt`;
        badge.style.minWidth = "90px";
        const input = document.createElement("input");
        input.type = "text";
        input.value = clusterNames[c.id] || "";
        input.placeholder = `Cluster ${c.id}`;
        input.title = "Rename cluster (Enter to apply)";
        input.style.flex = "1";
        input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                renameCluster(c.id, ev.target.value);
            }
        });
        input.addEventListener("change", (ev) => {
            renameCluster(c.id, ev.target.value);
        });
        const sel = document.createElement("button");
        sel.className = "button small";
        sel.textContent = "Select";
        sel.title = `Select all elements of ${getClusterLabel(c.id)}`;
        sel.addEventListener("click", () => selectCluster(c.id));
        row.appendChild(badge);
        row.appendChild(input);
        row.appendChild(sel);
        list.appendChild(row);
    });
}
/**
 * Calculate DBSCAN clusters using parameters from input
 */
function calculateClusters() {
    const minPts = parseFloat(document.getElementById("minPts").value);
    const epsilon = parseFloat(document.getElementById("epsilon").value);
    view.longCalculation(() => { dbscan(minPts, epsilon); }, // Run this
    "Calculating clusters, please be patient...", // Tell the user
    () => { view.coloringMode.set("Cluster"); refreshClusterList(); } // Then color by cluster
    );
}
/**
 * Calculate DBSCAN clusters using custom parameters
 */
// Algorithm and comments from:
// https://en.wikipedia.org/wiki/DBSCAN#Algorithm
function dbscan(minPts, eps) {
    const elems = Array.from(elements.values());
    const nElements = elements.size;
    clearClusters(); // Remove any previous clusters and reset counter
    const noise = -1; // Label for noise
    const getPos = (element) => {
        return element.getPos();
    };
    const findNeigbours = (p, eps) => {
        const neigbours = [];
        elems.forEach(q => {
            if (p != q) {
                let dist = getPos(p).distanceTo(getPos(q));
                if (dist < eps) {
                    neigbours.push(q);
                }
            }
        });
        return neigbours;
    };
    for (let i = 0; i < nElements; i++) {
        let p = elems[i];
        if (typeof p.clusterId !== 'undefined') {
            continue; // Previously processed in inner loop
        }
        // Find neigbours of p:
        let neigbours = findNeigbours(p, eps);
        if (neigbours.length < minPts) { // Density check
            p.clusterId = noise; // Label as noise
            continue;
        }
        clusterCounter++; // Next cluster id
        p.clusterId = clusterCounter; // Label initial point
        for (let j = 0; j < neigbours.length; j++) { // Process every seed point
            let q = neigbours[j];
            if ((typeof q.clusterId !== 'undefined') && // Previously processed
                (q.clusterId !== noise) // If noise, change it to border point
            ) {
                continue;
            }
            q.clusterId = clusterCounter; // Label neigbour
            // Find neigbours of q:
            let metaNeighbors = findNeigbours(q, eps);
            if (metaNeighbors.length >= minPts) { // Density check
                // Add new neigbours to seed set
                neigbours = neigbours.concat(metaNeighbors);
            }
        }
    }
}
/**
 * Add all selected elements to a new cluster
 */
function selectionToCluster() {
    if (selectedBases.size > 0) {
        clusterCounter++;
        selectedBases.forEach(element => {
            element.clusterId = clusterCounter;
        });
        view.coloringMode.set("Cluster"); // Then color by cluster
        refreshClusterList();
    }
    else {
        notify("First make a selection of elements you want to include in the cluster");
    }
}
/**
 * Intended for patchy particles
 * Assign clusters (and forces between pairs) from a PLClusterTopology output line
 * @param line a single line from a PLClusterTopology observable output file
 */
function clusterAndForcesFromClusterTopology(line) {
    const clusters = line.match(/\[.+?\]/g);
    const forces = [];
    for (const cluster of clusters) {
        const matches = cluster.match(/(\d+) -> \(((?:\d+ ?)+)\)/g);
        const clusterId = ++clusterCounter;
        for (const m of matches) {
            const groups = /(\d+) -> \(((?:\d+ ?)+)\)/.exec(m);
            const source = parseInt(groups[1]);
            const dests = groups[2].split(' ').map(i => parseInt(i));
            [source, dests].flat().forEach(i => {
                elements.get(i).clusterId = clusterId;
            });
            const s = elements.get(source);
            dests.forEach(dest => {
                const d = elements.get(dest);
                let trapA = new MutualTrap();
                trapA.set(s, d, 0.09);
                forces.push(trapA);
            });
        }
    }
    forceHandler.set(forces);
    view.coloringMode.set("Cluster");
    refreshClusterList();
}
