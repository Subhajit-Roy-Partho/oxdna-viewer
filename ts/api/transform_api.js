/**
 * transform_api.js — Rotation helpers and PCA for the LLM agent
 *
 * Extends the global `api` namespace (defined in dist/api/scene_api.js).
 * Must be loaded AFTER dist/api/scene_api.js and dist/editing/translation.js.
 *
 * New globals exposed:
 *   api.rotateGroup(elems, axis, angleDeg, pivot?)   → void
 *   api.rotateSingle(elem, axis, angleDeg, pivot?)   → void
 *   api.getCOM(elems)                                → THREE.Vector3
 *   api.getPCA(elems)                                → PCAResult
 */

// ── Centre of mass ────────────────────────────────────────────────────────────

/**
 * Compute the centre of mass of an array of elements.
 * @param {BasicElement[]} elems
 * @returns {THREE.Vector3}
 */
api.getCOM = function(elems) {
    var com = new THREE.Vector3();
    if (!elems || elems.length === 0) return com;
    elems.forEach(function(e) { com.add(e.getPos()); });
    com.divideScalar(elems.length);
    return com;
};

// ── Rotation helpers ──────────────────────────────────────────────────────────

/**
 * Rotate a group of elements around an axis by `angleDeg` degrees.
 *
 * @param {BasicElement[]} elems    Elements to rotate.
 * @param {THREE.Vector3}  axis     Rotation axis (need not be normalised).
 * @param {number}         angleDeg Rotation angle in degrees.
 * @param {THREE.Vector3}  [pivot]  Pivot point; defaults to group centre of mass.
 *
 * Example — rotate all monomers 90° around the Y axis:
 *   api.rotateGroup(systems[0].getMonomers(), new THREE.Vector3(0,1,0), 90);
 *
 * Example — rotate around a specific point:
 *   var junction = api.getElements([5])[0].getPos();
 *   api.rotateGroup(myElems, new THREE.Vector3(0,0,1), 45, junction);
 */
api.rotateGroup = function(elems, axis, angleDeg, pivot) {
    if (!elems || elems.length === 0) {
        notify('rotateGroup: no elements provided', 'warning');
        return;
    }
    var angleRad = angleDeg * Math.PI / 180;
    var normAxis = axis.clone().normalize();
    pivot = pivot || api.getCOM(elems);
    rotateElements(new Set(elems), normAxis, angleRad, pivot);
    render();
};

/**
 * Rotate a single element around an axis by `angleDeg` degrees.
 *
 * @param {BasicElement} elem       Element to rotate.
 * @param {THREE.Vector3} axis      Rotation axis.
 * @param {number}        angleDeg  Rotation angle in degrees.
 * @param {THREE.Vector3} [pivot]   Pivot point; defaults to the element's own position.
 *
 * Example — spin nucleotide 3 by 180° around X:
 *   var e = api.getElements([3])[0];
 *   api.rotateSingle(e, new THREE.Vector3(1,0,0), 180);
 */
api.rotateSingle = function(elem, axis, angleDeg, pivot) {
    if (!elem) {
        notify('rotateSingle: no element provided', 'warning');
        return;
    }
    var angleRad = angleDeg * Math.PI / 180;
    var normAxis = axis.clone().normalize();
    pivot = pivot || elem.getPos().clone();
    rotateElements(new Set([elem]), normAxis, angleRad, pivot);
    render();
};

/**
 * Rotate elements of a named cluster around an axis.
 * Looks up elements by clusterId from the global elements map.
 *
 * @param {number}        clusterId Cluster to rotate.
 * @param {THREE.Vector3} axis      Rotation axis.
 * @param {number}        angleDeg  Rotation angle in degrees.
 * @param {THREE.Vector3} [pivot]   Pivot; defaults to cluster centre of mass.
 */
api.rotateCluster = function(clusterId, axis, angleDeg, pivot) {
    var elems = [];
    systems.forEach(function(sys) {
        sys.getMonomers().forEach(function(e) {
            if (e.clusterId === clusterId) elems.push(e);
        });
    });
    tmpSystems.forEach(function(sys) {
        try {
            sys.getMonomers().forEach(function(e) {
                if (e.clusterId === clusterId) elems.push(e);
            });
        } catch (_) {}
    });
    if (elems.length === 0) {
        notify('rotateCluster: cluster ' + clusterId + ' not found', 'warning');
        return;
    }
    api.rotateGroup(elems, axis, angleDeg, pivot);
};

// ── PCA ───────────────────────────────────────────────────────────────────────

/**
 * Principal Component Analysis for a set of elements.
 *
 * Returns the three principal axes sorted by decreasing variance.
 * The primary axis is the direction of greatest positional spread — for a
 * straight DNA duplex this is the helix axis.
 *
 * @param {BasicElement[]} elems
 * @returns {{
 *   primaryAxis:   THREE.Vector3,   axis of greatest variance
 *   secondaryAxis: THREE.Vector3,
 *   tertiaryAxis:  THREE.Vector3,
 *   eigenvalues:   number[3],       variance along each axis (descending)
 *   center:        THREE.Vector3,   centre of mass
 *   spread:        number           RMS distance from center along primary axis
 * } | null}
 *
 * Example — find helix axis of a duplex and print it:
 *   var elems = systems[0].getMonomers();
 *   var pca = api.getPCA(elems);
 *   notify('Helix axis: ' + JSON.stringify(pca.primaryAxis), 'info');
 *
 * Example — align helix axis to Y by rotating:
 *   var pca = api.getPCA(systems[0].getMonomers());
 *   var q = new THREE.Quaternion().setFromUnitVectors(pca.primaryAxis, new THREE.Vector3(0,1,0));
 *   rotateElementsByQuaternion(new Set(systems[0].getMonomers()), q, pca.center);
 *   render();
 */
api.getPCA = function(elems) {
    if (!elems || elems.length < 3) {
        notify('getPCA: need at least 3 elements', 'warning');
        return null;
    }

    var center = api.getCOM(elems);
    var n = elems.length;

    // Build 3×3 covariance matrix (row-major, indices i*3+j)
    var C = [0,0,0, 0,0,0, 0,0,0];
    elems.forEach(function(e) {
        var p = e.getPos().clone().sub(center);
        C[0] += p.x*p.x; C[1] += p.x*p.y; C[2] += p.x*p.z;
        C[3] += p.y*p.x; C[4] += p.y*p.y; C[5] += p.y*p.z;
        C[6] += p.z*p.x; C[7] += p.z*p.y; C[8] += p.z*p.z;
    });
    for (var i = 0; i < 9; i++) C[i] /= n;

    // Jacobi eigendecomposition of symmetric 3×3
    var result = _pca_jacobiEigen3x3(C);
    var eigenvalues = result.eigenvalues;
    var eigenvectors = result.eigenvectors;

    // Sort by decreasing eigenvalue
    var order = [0, 1, 2].sort(function(a, b) { return eigenvalues[b] - eigenvalues[a]; });

    function makeVec(ev) { return new THREE.Vector3(ev[0], ev[1], ev[2]).normalize(); }

    var primaryAxis   = makeVec(eigenvectors[order[0]]);
    var secondaryAxis = makeVec(eigenvectors[order[1]]);
    var tertiaryAxis  = makeVec(eigenvectors[order[2]]);

    // RMS spread along primary axis
    var rmsSpread = 0;
    elems.forEach(function(e) {
        var proj = e.getPos().clone().sub(center).dot(primaryAxis);
        rmsSpread += proj * proj;
    });
    rmsSpread = Math.sqrt(rmsSpread / n);

    return {
        primaryAxis:   primaryAxis,
        secondaryAxis: secondaryAxis,
        tertiaryAxis:  tertiaryAxis,
        eigenvalues:   [eigenvalues[order[0]], eigenvalues[order[1]], eigenvalues[order[2]]],
        center:        center,
        spread:        rmsSpread
    };
};

// ── Jacobi eigendecomposition for symmetric 3×3 matrix ───────────────────────
// (Numerical Recipes §11.1 algorithm)

function _pca_jacobiEigen3x3(A) {
    var a = A.slice(); // working copy
    // V accumulates the product of all rotation matrices; columns = eigenvectors
    var V = [[1,0,0],[0,1,0],[0,0,1]];

    var MAX_ITER = 100;
    for (var iter = 0; iter < MAX_ITER; iter++) {
        // Find off-diagonal element with largest absolute value
        var maxVal = 0, p = 0, q = 1;
        var pairs = [[0,1],[0,2],[1,2]];
        for (var pi = 0; pi < 3; pi++) {
            var r0 = pairs[pi][0], c0 = pairs[pi][1];
            var v = Math.abs(a[r0*3 + c0]);
            if (v > maxVal) { maxVal = v; p = r0; q = c0; }
        }
        if (maxVal < 1e-12) break;

        // Rotation angle (Numerical Recipes "off" formula)
        var apq = a[p*3+q];
        var app = a[p*3+p];
        var aqq = a[q*3+q];
        var tau = (aqq - app) / (2.0 * apq);
        var t;
        if (tau >= 0) {
            t = 1.0 / (tau + Math.sqrt(1.0 + tau*tau));
        } else {
            t = 1.0 / (tau - Math.sqrt(1.0 + tau*tau));
        }
        var c = 1.0 / Math.sqrt(1.0 + t*t);
        var s = t * c;

        // Update diagonal
        a[p*3+p] = app - t * apq;
        a[q*3+q] = aqq + t * apq;
        a[p*3+q] = 0.0;
        a[q*3+p] = 0.0;

        // Update off-diagonal rows/cols (r ≠ p, q)
        for (var r = 0; r < 3; r++) {
            if (r !== p && r !== q) {
                var arp = a[r*3+p], arq = a[r*3+q];
                a[r*3+p] = c*arp - s*arq;
                a[p*3+r] = c*arp - s*arq;
                a[r*3+q] = s*arp + c*arq;
                a[q*3+r] = s*arp + c*arq;
            }
        }

        // Accumulate rotation into V
        for (var ri = 0; ri < 3; ri++) {
            var vrp = V[ri][p], vrq = V[ri][q];
            V[ri][p] = c*vrp - s*vrq;
            V[ri][q] = s*vrp + c*vrq;
        }
    }

    // Eigenvalues = diagonal; eigenvectors = columns of V
    return {
        eigenvalues: [a[0], a[4], a[8]],
        eigenvectors: [
            [V[0][0], V[1][0], V[2][0]],
            [V[0][1], V[1][1], V[2][1]],
            [V[0][2], V[1][2], V[2][2]]
        ]
    };
}
