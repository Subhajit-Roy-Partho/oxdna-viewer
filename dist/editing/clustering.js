/**
 * Clear clusters and reset the cluster counter
 */
function clearClusters() {
    clusterCounter = 0; // Cluster counter
    elements.forEach(element => {
        delete element.clusterId;
    });
    view.coloringMode.set("Strand"); // Then color by strand
}
/**
 * Calculate DBSCAN clusters using parameters from input
 */
function calculateClusters() {
    const minPts = parseFloat(document.getElementById("minPts").value);
    const epsilon = parseFloat(document.getElementById("epsilon").value);
    view.longCalculation(() => { dbscan(minPts, epsilon); }, // Run this
    "Calculating clusters, please be patient...", // Tell the user
    () => { view.coloringMode.set("Cluster"); } // Then color by cluster
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
}
