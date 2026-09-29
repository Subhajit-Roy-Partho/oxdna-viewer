/**
 * shapes_api.js — Place nucleotide strands along 3-D geometric shapes
 *
 * Must be loaded AFTER:
 *   dist/api/editing_api.js   (edit.createStrand, edit.deleteElements)
 *   dist/editing/translation.js (calcsp, translateElements)
 *   ts/api/llm_tracker_api.js  (llmTracker.tag)
 *
 * New global exposed: `shapes`
 *
 * All functions accept an optional `tagName` parameter.  When provided, the
 * created elements are automatically registered with llmTracker so they can
 * be referred to by name in later code blocks.
 *
 * Spacing note: 1 oxDNA unit ≈ 0.85 nm.  A natural-looking strand has
 * adjacent nucleotides ~0.6–1 unit apart.  For tighter shapes use more
 * bases (smaller spacing); for sparser visualisation use fewer.
 *
 * Quick reference:
 *   shapes.line(p1, p2, nBases, seq?, isRNA?, tagName?)       → elems
 *   shapes.circle(center, normal, radius, nBases, ...)        → elems
 *   shapes.polygon(nSides, center, normal, radius, bps, ...)  → elems
 *   shapes.triangle(center, normal, sideLen, bps, ...)        → elems
 *   shapes.square(center, normal, sideLen, bps, ...)          → elems
 *   shapes.star(center, normal, outerR, innerR, nPts, bpe, ...) → elems
 *   shapes.cube(center, sideLen, bpe, seq?, isRNA?, tagName?) → elems
 *   shapes.tetrahedron(center, sideLen, bpe, ...)             → elems
 *   shapes.sphere(center, radius, nBases, ...)                → elems
 *   shapes.helix(center, axis, radius, rise, turns, nBases, ...) → elems
 *   shapes.pointCloud(points, seq?, isRNA?, tagName?)         → elems
 *   shapes.basesForLength(length, spacing?)                   → number
 * Duplex outline routing (real B-DNA, auto-ligated at vertices):
 *   shapes.duplexEdge(p0, p1, seq?, isRNA?, tag?)             → elems
 *   shapes.outline(points, {closed?, seq?, isRNA?, tag?, ligate?, threshold?})
 *   shapes.triangleDuplex(center, normal, sideLen, seq?, isRNA?, tag?)
 *   shapes.triLattice(nx, ny, sideLen, center?, normal?)      → pure geometry
 *   shapes.triangleCrystal(center, normal, sideLen, nx, ny, nz, opts?)
 */

window.shapes = (function() {

    // ── private helpers ────────────────────────────────────────────────────────

    function _randomSeq(n, isRNA) {
        var bases = isRNA ? ['A','U','G','C'] : ['A','T','G','C'];
        var s = '';
        for (var i = 0; i < n; i++) s += bases[Math.floor(Math.random() * 4)];
        return s;
    }

    /** Build an a1/a3 orientation frame given a forward (a3) direction. */
    function _frameFromForward(forward) {
        var a3 = forward.clone().normalize();
        var up = (Math.abs(a3.y) < 0.8) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
        var a1 = new THREE.Vector3().crossVectors(a3, up).normalize();
        return { a1: a1, a3: a3 };
    }

    /**
     * Core placement function.
     * Creates one strand with `seq.length` bases and repositions each element
     * to the supplied positions using calcPositions(p, a1, a3).
     *
     * @param {THREE.Vector3[]} positions
     * @param {THREE.Vector3[]} a1s   - base-pair axis at each position
     * @param {THREE.Vector3[]} a3s   - stacking axis at each position
     * @param {string|null}     seq
     * @param {boolean}         isRNA
     * @param {string|null}     tagName
     * @returns {BasicElement[]}
     */
    function _place(positions, a1s, a3s, seq, isRNA, tagName) {
        var n = positions.length;
        if (n === 0) return [];

        seq = (seq && seq.length >= n) ? seq.slice(0, n) : _randomSeq(n, isRNA);

        // Create a single-stranded strand (no duplex) to get n nucleotides
        var elems = edit.createStrand(seq, false, isRNA || false);
        var valid = elems.filter(Boolean);
        if (valid.length === 0) return [];

        // Reposition each nucleotide to the target position and orientation
        for (var i = 0; i < Math.min(valid.length, n); i++) {
            valid[i].calcPositions(positions[i], a1s[i], a3s[i]);
        }

        // Recalculate backbone connectors with the new positions
        valid.forEach(function(e) { if (e.n3) calcsp(e); });

        // Flush to GPU
        var sys = valid[0].dummySys || valid[0].getSystem();
        sys.callAllUpdates();

        // Tag and colour if requested
        if (tagName != null) {
            llmTracker.tag(valid, tagName);
        }

        render();
        return valid;
    }

    /**
     * Place a strand along a list of arbitrary 3-D points.
     * a3 = forward direction to next point; a1 = perpendicular.
     */
    function _strandAlongPoints(points, faceNormal, seq, isRNA, tagName) {
        var n = points.length;
        var a1s = [], a3s = [];
        for (var i = 0; i < n; i++) {
            var a3;
            if (i < n - 1) {
                a3 = points[i + 1].clone().sub(points[i]).normalize();
            } else {
                a3 = (n > 1) ? points[i].clone().sub(points[i-1]).normalize()
                             : new THREE.Vector3(0, 0, 1);
            }
            var frame = _frameFromForward(a3);
            var a1 = faceNormal ? faceNormal.clone().normalize() : frame.a1;
            a1s.push(a1);
            a3s.push(a3);
        }
        return _place(points, a1s, a3s, seq, isRNA, tagName);
    }

    // ── exported shapes object ─────────────────────────────────────────────────

    var shapes = {};

    /**
     * Recommended number of bases for a segment of given length.
     * @param {number} length      Length in oxDNA units.
     * @param {number} [spacing=1] Desired base-to-base spacing in oxDNA units.
     * @returns {number}
     */
    shapes.basesForLength = function(length, spacing) {
        spacing = spacing || 1.0;
        return Math.max(2, Math.round(length / spacing));
    };

    // ─────────────────────────────────────────────────────────────────────────
    // LINE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place a strand along a straight line from p1 to p2.
     *
     * @param {THREE.Vector3} p1
     * @param {THREE.Vector3} p2
     * @param {number}  nBases  Number of nucleotides (distributed evenly).
     * @param {string}  [seq]   Sequence string (auto-generated if omitted).
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example:
     *   shapes.line(new THREE.Vector3(0,0,0), new THREE.Vector3(10,0,0), 12, null, false, 'myLine');
     */
    shapes.line = function(p1, p2, nBases, seq, isRNA, tagName) {
        nBases = nBases || 10;
        var points = [];
        for (var i = 0; i < nBases; i++) {
            points.push(p1.clone().lerp(p2, nBases > 1 ? i / (nBases - 1) : 0));
        }
        return _strandAlongPoints(points, null, seq, isRNA, tagName != null ? tagName : 'line');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // CIRCLE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place a closed-loop strand around a circle.
     *
     * @param {THREE.Vector3} center
     * @param {THREE.Vector3} normal  Normal to the circle plane (e.g. new THREE.Vector3(0,1,0) for XZ plane).
     * @param {number}  radius        Circle radius in oxDNA units.
     * @param {number}  nBases
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example — circle of 24 bases in the XZ plane:
     *   shapes.circle(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 8, 24, null, false, 'ring');
     */
    shapes.circle = function(center, normal, radius, nBases, seq, isRNA, tagName) {
        nBases = nBases || 24;
        radius = radius || 5;
        normal = normal ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);

        // Build orthonormal frame in the circle plane
        var upGuess = (Math.abs(normal.y) < 0.9) ? new THREE.Vector3(0, 1, 0)
                                                  : new THREE.Vector3(1, 0, 0);
        var u = new THREE.Vector3().crossVectors(normal, upGuess).normalize();
        var v = new THREE.Vector3().crossVectors(normal, u).normalize();

        var positions = [], a1s = [], a3s = [];
        for (var i = 0; i < nBases; i++) {
            var theta = (2 * Math.PI * i) / nBases;
            var cosT = Math.cos(theta), sinT = Math.sin(theta);
            var thetaNext = (2 * Math.PI * (i + 1)) / nBases;

            var pos = center.clone()
                .addScaledVector(u, cosT * radius)
                .addScaledVector(v, sinT * radius);

            // a1 = radial outward; a3 = tangential (CCW)
            var a1 = u.clone().multiplyScalar(cosT).addScaledVector(v, sinT).normalize();
            var a3 = u.clone().multiplyScalar(-sinT).addScaledVector(v, cosT).normalize();

            positions.push(pos);
            a1s.push(a1);
            a3s.push(a3);
        }

        return _place(positions, a1s, a3s, seq, isRNA, tagName != null ? tagName : 'circle');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // REGULAR POLYGON
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place nucleotides along the edges of a regular n-sided polygon.
     * Each edge is a separate strand (so edges have backbone bonds internally
     * but are disconnected from one another at the vertices).
     *
     * @param {number}  nSides
     * @param {THREE.Vector3} center
     * @param {THREE.Vector3} normal
     * @param {number}  radius        Circumscribed circle radius.
     * @param {number}  basesPerSide  Nucleotides per edge.
     * @param {string}  [seq]         If given, cycled across all edges.
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example — hexagon:
     *   shapes.polygon(6, new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 10, 8, null, false, 'hex');
     */
    shapes.polygon = function(nSides, center, normal, radius, basesPerSide, seq, isRNA, tagName) {
        nSides = nSides || 6;
        basesPerSide = basesPerSide || 6;
        radius = radius || 8;
        normal = normal ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);

        var upGuess = (Math.abs(normal.y) < 0.9) ? new THREE.Vector3(0, 1, 0)
                                                  : new THREE.Vector3(1, 0, 0);
        var u = new THREE.Vector3().crossVectors(normal, upGuess).normalize();
        var v = new THREE.Vector3().crossVectors(normal, u).normalize();

        var allElems = [];
        var seqOffset = 0;
        var totalBases = nSides * basesPerSide;
        var fullSeq = (seq && seq.length >= totalBases) ? seq : _randomSeq(totalBases, isRNA);

        for (var side = 0; side < nSides; side++) {
            var theta0 = (2 * Math.PI * side) / nSides;
            var theta1 = (2 * Math.PI * (side + 1)) / nSides;

            var v0 = center.clone()
                .addScaledVector(u, Math.cos(theta0) * radius)
                .addScaledVector(v, Math.sin(theta0) * radius);
            var v1 = center.clone()
                .addScaledVector(u, Math.cos(theta1) * radius)
                .addScaledVector(v, Math.sin(theta1) * radius);

            var edgeDir = v1.clone().sub(v0).normalize();
            var midTheta = (theta0 + theta1) / 2;
            var a1 = u.clone().multiplyScalar(Math.cos(midTheta))
                      .addScaledVector(v, Math.sin(midTheta)).normalize();

            var points = [], a1s = [], a3s = [];
            for (var j = 0; j < basesPerSide; j++) {
                var t = basesPerSide > 1 ? j / (basesPerSide - 1) : 0;
                points.push(v0.clone().lerp(v1, t));
                a1s.push(a1.clone());
                a3s.push(edgeDir.clone());
            }

            var edgeSeq = fullSeq.slice(seqOffset, seqOffset + basesPerSide);
            seqOffset += basesPerSide;

            // Place without tagging here; we tag the whole shape at the end
            var edgeElems = _place(points, a1s, a3s, edgeSeq, isRNA, null);
            allElems = allElems.concat(edgeElems);
        }

        var tName = tagName != null ? tagName : ('polygon' + nSides);
        if (tName) llmTracker.tag(allElems, tName);
        render();
        return allElems;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // TRIANGLE / SQUARE (convenience wrappers around polygon)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Equilateral triangle.
     *
     * @param {THREE.Vector3} center
     * @param {THREE.Vector3} normal
     * @param {number}  sideLength    Edge length in oxDNA units.
     * @param {number}  basesPerSide
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     *
     * Example:
     *   shapes.triangle(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 12, 8, null, false, 'tri');
     */
    shapes.triangle = function(center, normal, sideLength, basesPerSide, seq, isRNA, tagName) {
        sideLength = sideLength || 12;
        basesPerSide = basesPerSide || 8;
        // Circumscribed circle radius for equilateral triangle: R = side / sqrt(3)
        var radius = sideLength / Math.sqrt(3);
        return shapes.polygon(3, center, normal, radius, basesPerSide, seq, isRNA,
                              tagName != null ? tagName : 'triangle');
    };

    /**
     * Square.
     *
     * @param {THREE.Vector3} center
     * @param {THREE.Vector3} normal
     * @param {number}  sideLength
     * @param {number}  basesPerSide
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     *
     * Example:
     *   shapes.square(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 10, 8, null, false, 'sq');
     */
    shapes.square = function(center, normal, sideLength, basesPerSide, seq, isRNA, tagName) {
        sideLength = sideLength || 10;
        basesPerSide = basesPerSide || 8;
        // Circumscribed circle radius for square: R = side * sqrt(2) / 2
        var radius = sideLength * Math.sqrt(2) / 2;
        return shapes.polygon(4, center, normal, radius, basesPerSide, seq, isRNA,
                              tagName != null ? tagName : 'square');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // STAR (n-pointed star outline)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place nucleotides along the outline of an n-pointed star: a closed
     * zig-zag alternating between `numPoints` outer vertices (on outerRadius)
     * and `numPoints` inner vertices (on innerRadius). Produces 2*numPoints
     * edges, each a separate strand.
     *
     * @param {THREE.Vector3} center
     * @param {THREE.Vector3} normal        Plane normal (e.g. new THREE.Vector3(0,0,1) for XY plane).
     * @param {number}  outerRadius
     * @param {number}  innerRadius         Typically 0.35–0.5 * outerRadius.
     * @param {number}  numPoints           Number of star points (>= 2).
     * @param {number}  basesPerEdge
     * @param {string}  [seq]               Cycled across all edges.
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example — 5-point star in the XY plane:
     *   shapes.star(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 10, 4, 5, 6, null, false, 'star1');
     */
    shapes.star = function(center, normal, outerRadius, innerRadius, numPoints, basesPerEdge, seq, isRNA, tagName) {
        numPoints    = Math.max(2, numPoints || 5);
        outerRadius  = outerRadius || 10;
        innerRadius  = innerRadius || (outerRadius * 0.4);
        basesPerEdge = basesPerEdge || 6;
        normal = normal ? normal.clone().normalize() : new THREE.Vector3(0, 0, 1);

        var upGuess = (Math.abs(normal.y) < 0.9) ? new THREE.Vector3(0, 1, 0)
                                                  : new THREE.Vector3(1, 0, 0);
        var u = new THREE.Vector3().crossVectors(normal, upGuess).normalize();
        var v = new THREE.Vector3().crossVectors(normal, u).normalize();

        // 2*numPoints vertices, alternating outer / inner
        var nVerts = numPoints * 2;
        var verts = [];
        for (var k = 0; k < nVerts; k++) {
            var r = (k % 2 === 0) ? outerRadius : innerRadius;
            var theta = (Math.PI * k) / numPoints;   // 2π / nVerts
            verts.push(center.clone()
                .addScaledVector(u, Math.cos(theta) * r)
                .addScaledVector(v, Math.sin(theta) * r));
        }

        var totalBases = nVerts * basesPerEdge;
        var fullSeq = (seq && seq.length >= totalBases) ? seq : _randomSeq(totalBases, isRNA);
        var seqOffset = 0;
        var allElems = [];

        for (var e = 0; e < nVerts; e++) {
            var p0 = verts[e], p1 = verts[(e + 1) % nVerts];
            var edgeDir = p1.clone().sub(p0).normalize();
            var mid = p0.clone().lerp(p1, 0.5);
            var toCenter = center.clone().sub(mid);
            var a1 = toCenter.lengthSq() > 1e-6 ? toCenter.normalize() : u.clone();

            var points = [], a1s = [], a3s = [];
            for (var j = 0; j < basesPerEdge; j++) {
                var t = basesPerEdge > 1 ? j / (basesPerEdge - 1) : 0;
                points.push(p0.clone().lerp(p1, t));
                a1s.push(a1.clone());
                a3s.push(edgeDir.clone());
            }
            var edgeSeq = fullSeq.slice(seqOffset, seqOffset + basesPerEdge);
            seqOffset += basesPerEdge;
            allElems = allElems.concat(_place(points, a1s, a3s, edgeSeq, isRNA, null));
        }

        var tName = tagName != null ? tagName : ('star' + numPoints);
        if (tName) llmTracker.tag(allElems, tName);
        render();
        return allElems;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // CUBE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place nucleotides along the 12 edges of a cube.
     * Each edge is a separate strand.
     *
     * @param {THREE.Vector3} center
     * @param {number}  sideLength
     * @param {number}  basesPerEdge
     * @param {string}  [seq]        Cycled across all 12 edges.
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example:
     *   shapes.cube(new THREE.Vector3(0,0,0), 10, 5, null, false, 'myCube');
     */
    shapes.cube = function(center, sideLength, basesPerEdge, seq, isRNA, tagName) {
        sideLength = sideLength || 10;
        basesPerEdge = basesPerEdge || 5;
        var h = sideLength / 2;

        // 8 vertices
        var verts = [
            [-h,-h,-h], [+h,-h,-h], [+h,+h,-h], [-h,+h,-h],
            [-h,-h,+h], [+h,-h,+h], [+h,+h,+h], [-h,+h,+h]
        ].map(function(xyz) {
            return new THREE.Vector3(xyz[0]+center.x, xyz[1]+center.y, xyz[2]+center.z);
        });

        // 12 edges (vertex index pairs)
        var edges = [
            [0,1],[1,2],[2,3],[3,0],   // bottom face
            [4,5],[5,6],[6,7],[7,4],   // top face
            [0,4],[1,5],[2,6],[3,7]    // verticals
        ];

        var totalBases = edges.length * basesPerEdge;
        var fullSeq = (seq && seq.length >= totalBases) ? seq : _randomSeq(totalBases, isRNA);
        var seqOffset = 0;
        var allElems = [];

        edges.forEach(function(edge) {
            var p0 = verts[edge[0]], p1 = verts[edge[1]];
            var edgeDir = p1.clone().sub(p0).normalize();
            var mid = p0.clone().lerp(p1, 0.5);
            var toCenter = center.clone().sub(mid);
            var a1 = toCenter.lengthSq() > 0.001 ? toCenter.normalize()
                                                  : new THREE.Vector3(1, 0, 0);

            var points = [], a1s = [], a3s = [];
            for (var j = 0; j < basesPerEdge; j++) {
                var t = basesPerEdge > 1 ? j / (basesPerEdge - 1) : 0;
                points.push(p0.clone().lerp(p1, t));
                a1s.push(a1.clone());
                a3s.push(edgeDir.clone());
            }

            var edgeSeq = fullSeq.slice(seqOffset, seqOffset + basesPerEdge);
            seqOffset += basesPerEdge;
            allElems = allElems.concat(_place(points, a1s, a3s, edgeSeq, isRNA, null));
        });

        var tName = tagName != null ? tagName : 'cube';
        if (tName) llmTracker.tag(allElems, tName);
        render();
        return allElems;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // TETRAHEDRON
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place nucleotides along the 6 edges of a regular tetrahedron.
     *
     * @param {THREE.Vector3} center
     * @param {number}  sideLength
     * @param {number}  basesPerEdge
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example:
     *   shapes.tetrahedron(new THREE.Vector3(0,0,0), 10, 6, null, false, 'tetra');
     */
    shapes.tetrahedron = function(center, sideLength, basesPerEdge, seq, isRNA, tagName) {
        sideLength = sideLength || 10;
        basesPerEdge = basesPerEdge || 6;
        // Circumscribed radius R = side * sqrt(6) / 4
        var R = sideLength * Math.sqrt(6) / 4;

        var verts = [
            new THREE.Vector3( 1,  1,  1),
            new THREE.Vector3( 1, -1, -1),
            new THREE.Vector3(-1,  1, -1),
            new THREE.Vector3(-1, -1,  1)
        ].map(function(v) {
            return v.normalize().multiplyScalar(R).add(center);
        });

        var edges = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
        var totalBases = edges.length * basesPerEdge;
        var fullSeq = (seq && seq.length >= totalBases) ? seq : _randomSeq(totalBases, isRNA);
        var seqOffset = 0;
        var allElems = [];

        edges.forEach(function(edge) {
            var p0 = verts[edge[0]], p1 = verts[edge[1]];
            var edgeDir = p1.clone().sub(p0).normalize();
            var mid = p0.clone().lerp(p1, 0.5);
            var toCenter = center.clone().sub(mid);
            var a1 = toCenter.lengthSq() > 0.001 ? toCenter.normalize()
                                                  : new THREE.Vector3(1, 0, 0);

            var points = [], a1s = [], a3s = [];
            for (var j = 0; j < basesPerEdge; j++) {
                var t = basesPerEdge > 1 ? j / (basesPerEdge - 1) : 0;
                points.push(p0.clone().lerp(p1, t));
                a1s.push(a1.clone());
                a3s.push(edgeDir.clone());
            }

            var edgeSeq = fullSeq.slice(seqOffset, seqOffset + basesPerEdge);
            seqOffset += basesPerEdge;
            allElems = allElems.concat(_place(points, a1s, a3s, edgeSeq, isRNA, null));
        });

        var tName = tagName != null ? tagName : 'tetrahedron';
        if (tName) llmTracker.tag(allElems, tName);
        render();
        return allElems;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // SPHERE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place nucleotides over a sphere surface using a Fibonacci lattice
     * (uniform distribution).
     *
     * @param {THREE.Vector3} center
     * @param {number}  radius
     * @param {number}  nBases
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example:
     *   shapes.sphere(new THREE.Vector3(0,0,0), 8, 50, null, false, 'ball');
     */
    shapes.sphere = function(center, radius, nBases, seq, isRNA, tagName) {
        nBases = nBases || 50;
        radius = radius || 8;

        var PHI = Math.PI * (3 - Math.sqrt(5)); // golden angle
        var positions = [], a1s = [], a3s = [];

        for (var i = 0; i < nBases; i++) {
            var y = 1 - (i / (nBases - 1)) * 2;  // y ∈ [-1, 1]
            var r = Math.sqrt(1 - y * y);
            var theta = PHI * i;

            var x = Math.cos(theta) * r;
            var z = Math.sin(theta) * r;

            var pos = new THREE.Vector3(x, y, z).multiplyScalar(radius).add(center);
            var a1 = new THREE.Vector3(x, y, z).normalize(); // radial outward

            // a3 = tangent along latitude circle
            var a3 = new THREE.Vector3(-Math.sin(theta) * r, 0, Math.cos(theta) * r);
            if (a3.lengthSq() < 0.001) a3.set(1, 0, 0);
            a3.normalize();

            positions.push(pos);
            a1s.push(a1);
            a3s.push(a3);
        }

        return _place(positions, a1s, a3s, seq, isRNA,
                      tagName != null ? tagName : 'sphere');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // HELIX (custom, distinct from DNA helix)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place a strand along a 3-D helix path.
     *
     * @param {THREE.Vector3} center   Centre of the helix.
     * @param {THREE.Vector3} axis     Helix axis direction.
     * @param {number}  radius         Radius of the helix coil.
     * @param {number}  risePerBase    Axial rise per base (oxDNA units).
     * @param {number}  turns          Total number of full turns.
     * @param {number}  nBases
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example — 3-turn coil around Y axis, radius 3:
     *   shapes.helix(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 3, 0.4, 3, 30, null, false, 'coil');
     */
    shapes.helix = function(center, axis, radius, risePerBase, turns, nBases, seq, isRNA, tagName) {
        nBases = nBases || 20;
        radius = radius || 3;
        risePerBase = risePerBase || 0.4;
        turns = turns || 2;
        axis = axis ? axis.clone().normalize() : new THREE.Vector3(0, 1, 0);

        var upGuess = (Math.abs(axis.y) < 0.9) ? new THREE.Vector3(0, 1, 0)
                                                : new THREE.Vector3(1, 0, 0);
        var u = new THREE.Vector3().crossVectors(axis, upGuess).normalize();
        var v = new THREE.Vector3().crossVectors(axis, u).normalize();

        var totalAngle = turns * 2 * Math.PI;
        var totalRise  = nBases * risePerBase;
        var startRise  = -totalRise / 2;
        var dTheta     = nBases > 1 ? totalAngle / (nBases - 1) : 0;

        var positions = [], a1s = [], a3s = [];

        for (var i = 0; i < nBases; i++) {
            var theta = i * dTheta;
            var rise  = startRise + i * risePerBase;

            var pos = center.clone()
                .addScaledVector(axis, rise)
                .addScaledVector(u, Math.cos(theta) * radius)
                .addScaledVector(v, Math.sin(theta) * radius);

            var a1 = u.clone().multiplyScalar(Math.cos(theta))
                      .addScaledVector(v, Math.sin(theta)).normalize();

            // Helical tangent
            var a3 = axis.clone().multiplyScalar(risePerBase)
                         .addScaledVector(u, -Math.sin(theta) * radius * dTheta)
                         .addScaledVector(v,  Math.cos(theta) * radius * dTheta);
            if (a3.lengthSq() < 0.001) a3.set(0, 1, 0);
            a3.normalize();

            positions.push(pos);
            a1s.push(a1);
            a3s.push(a3);
        }

        return _place(positions, a1s, a3s, seq, isRNA,
                      tagName != null ? tagName : 'helix');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // POINT CLOUD
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place one nucleotide at each point in an arbitrary 3-D point cloud.
     * a3 is oriented toward the nearest neighbour; a1 is perpendicular.
     *
     * @param {THREE.Vector3[]} points
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     *
     * Example — 5 specific positions:
     *   var pts = [
     *     new THREE.Vector3(0,0,0), new THREE.Vector3(2,0,0),
     *     new THREE.Vector3(1,2,0), new THREE.Vector3(0,1,1), new THREE.Vector3(2,1,1)
     *   ];
     *   shapes.pointCloud(pts, null, false, 'cloud');
     */
    shapes.pointCloud = function(points, seq, isRNA, tagName) {
        var n = points.length;
        if (n === 0) return [];

        var a1s = [], a3s = [];
        for (var i = 0; i < n; i++) {
            var minDist = Infinity, nearest = -1;
            for (var j = 0; j < n; j++) {
                if (j === i) continue;
                var d = points[i].distanceTo(points[j]);
                if (d < minDist) { minDist = d; nearest = j; }
            }
            var a3 = nearest >= 0
                ? points[nearest].clone().sub(points[i]).normalize()
                : new THREE.Vector3(0, 0, 1);
            var frame = _frameFromForward(a3);
            a1s.push(frame.a1);
            a3s.push(a3);
        }

        return _place(points, a1s, a3s, seq, isRNA,
                      tagName != null ? tagName : 'pointCloud');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // SPIRAL / STAR
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place a strand along an Archimedean spiral in a plane.
     *
     * @param {THREE.Vector3} center
     * @param {THREE.Vector3} normal
     * @param {number}  startRadius    Radius at first base.
     * @param {number}  endRadius      Radius at last base.
     * @param {number}  turns
     * @param {number}  nBases
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tagName]
     * @returns {BasicElement[]}
     */
    shapes.spiral = function(center, normal, startRadius, endRadius, turns, nBases, seq, isRNA, tagName) {
        nBases = nBases || 30;
        startRadius = startRadius || 1;
        endRadius = endRadius || 8;
        turns = turns || 3;
        normal = normal ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);

        var upGuess = (Math.abs(normal.y) < 0.9) ? new THREE.Vector3(0, 1, 0)
                                                  : new THREE.Vector3(1, 0, 0);
        var u = new THREE.Vector3().crossVectors(normal, upGuess).normalize();
        var v = new THREE.Vector3().crossVectors(normal, u).normalize();

        var totalAngle = turns * 2 * Math.PI;
        var positions = [], a1s = [], a3s = [];

        for (var i = 0; i < nBases; i++) {
            var t = nBases > 1 ? i / (nBases - 1) : 0;
            var theta = t * totalAngle;
            var r = startRadius + t * (endRadius - startRadius);

            var pos = center.clone()
                .addScaledVector(u, Math.cos(theta) * r)
                .addScaledVector(v, Math.sin(theta) * r);

            var a1 = u.clone().multiplyScalar(Math.cos(theta))
                      .addScaledVector(v, Math.sin(theta)).normalize();
            var dR = (endRadius - startRadius) / Math.max(1, nBases - 1);
            var a3 = u.clone().multiplyScalar(-Math.sin(theta) * r)
                      .addScaledVector(v, Math.cos(theta) * r)
                      .addScaledVector(u, dR * Math.cos(theta))
                      .addScaledVector(v, dR * Math.sin(theta));
            if (a3.lengthSq() < 0.001) a3.set(1, 0, 0);
            a3.normalize();

            positions.push(pos);
            a1s.push(a1);
            a3s.push(a3);
        }

        return _place(positions, a1s, a3s, seq, isRNA,
                      tagName != null ? tagName : 'spiral');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // DUPLEX OUTLINE ROUTING (real B-DNA duplexes along edges, PERDIX-style)
    // ─────────────────────────────────────────────────────────────────────────
    //
    // Unlike the nucleotide point-cloud shapes above, these build ideal B-DNA
    // duplexes (edit.createStrand with createDuplex=true) and orient each one
    // along an outline edge via its PCA helix axis, then auto-detect which
    // ends meet at each vertex and ligate them (greedy closest 5'/3' pairing).
    // Ref: Jun et al., Sci Adv 2019 (PERDIX) — outline → duplex edges +
    // unpaired-nt vertex rule; here single-duplex edges instead of DX edges.
    //
    //   shapes.duplexEdge(p0, p1, seq?, isRNA?, tag?)
    //   shapes.outline(points, opts?)          → elems (with .edges/.ligated)
    //   shapes.triangleDuplex(center, normal, sideLen, seq?, isRNA?, tag?)
    //   shapes.triLattice(nx, ny, sideLen, center?, normal?) → pure geometry
    //   shapes.triangleCrystal(center, normal, sideLen, nx, ny, nz, opts?)

    /** Axial rise per base-pair for a B-DNA duplex, in oxDNA units (~0.34 nm). */
    shapes.DUPLEX_RISE = 0.4;

    /**
     * Orient an already-created duplex along the segment p0→p1:
     * PCA helix axis → edge direction (quaternion), COM → segment midpoint.
     */
    function _orientDuplexToEdge(valid, p0, p1) {
        var com = api.getCOM(valid);
        var cur = null;
        try {
            if (valid.length >= 3 && api.getPCA) {
                var pca = api.getPCA(valid);
                if (pca && pca.primaryAxis) cur = pca.primaryAxis.clone();
            }
        } catch(_) {}
        if (!cur) cur = new THREE.Vector3(0, 0, 1);
        var want = p1.clone().sub(p0);
        if (want.lengthSq() < 1e-8) want.set(0, 0, 1);
        want.normalize();
        var q = new THREE.Quaternion().setFromUnitVectors(cur.clone().normalize(), want);
        rotateElementsByQuaternion(new Set(valid), q, com);
        var com2 = api.getCOM(valid);
        var mid = p0.clone().lerp(p1, 0.5);
        translateElements(new Set(valid), mid.sub(com2));
        valid.forEach(function(e) { if (e.n3) calcsp(e); });
        var sys = valid[0].dummySys || valid[0].getSystem();
        sys.callAllUpdates();
    }

    /**
     * Greedy closest-pair ligation over the strand ends found in `elems`.
     * Only ends belonging to these elements are considered (never touches
     * unrelated structures). Returns {ligated, pairs:[{aId,bId,dist}]}.
     */
    function _ligateEndsGreedy(elems, threshold, allowCircular) {
        threshold = (threshold == null) ? 1.5 : threshold;
        var strands = {}, ids = [];
        elems.forEach(function(e) {
            if (e && e.strand && !strands[e.strand.id]) {
                strands[e.strand.id] = e.strand;
                ids.push(e.strand.id);
            }
        });
        var open5 = [], open3 = [];
        ids.forEach(function(id) {
            var st = strands[id];
            if (st.end5 && !st.end5.n5) open5.push(st.end5);
            if (st.end3 && !st.end3.n3) open3.push(st.end3);
        });
        var cands = [];
        open3.forEach(function(e3) {
            var p3;
            try { p3 = e3.getPos(); } catch(_) { return; }
            open5.forEach(function(e5) {
                if (e3 === e5) return;
                var p5;
                try { p5 = e5.getPos(); } catch(_) { return; }
                var d = p3.distanceTo(p5);
                if (d <= threshold) cands.push({ e3: e3, e5: e5, dist: d });
            });
        });
        cands.sort(function(a, b) { return a.dist - b.dist; });
        var used = {}, pairs = [], n = 0;
        cands.forEach(function(cd) {
            if (used[cd.e3.id] || used[cd.e5.id]) return;
            if (!allowCircular && cd.e3.strand === cd.e5.strand) return;
            try {
                edit.ligate(cd.e3, cd.e5);
                used[cd.e3.id] = used[cd.e5.id] = true;
                n++;
                pairs.push({ aId: cd.e3.id, bId: cd.e5.id, dist: Math.round(cd.dist * 10) / 10 });
            } catch(_) { /* incompatible — skip */ }
        });
        return { ligated: n, pairs: pairs };
    }

    /**
     * Place one ideal B-DNA duplex along the segment p0→p1.
     *
     * @param {THREE.Vector3} p0, p1
     * @param {string}  [seq]     Auto-generated if too short (needs len/0.4 bp).
     * @param {boolean} [isRNA]
     * @param {string}  [tagName] Registered as kind 'duplex'. Null = untagged.
     * @returns {BasicElement[]}
     *
     * Example:
     *   shapes.duplexEdge(new THREE.Vector3(0,0,0), new THREE.Vector3(12,0,0),
     *                     null, false, 'edge1');
     */
    shapes.duplexEdge = function(p0, p1, seq, isRNA, tagName) {
        p0 = p0.clone(); p1 = p1.clone();
        var len = p0.distanceTo(p1);
        var nBp = Math.max(6, Math.round(len / shapes.DUPLEX_RISE));
        seq = (seq && seq.length >= nBp) ? seq.slice(0, nBp) : _randomSeq(nBp, isRNA);
        var elems = edit.createStrand(seq, true, isRNA || false);
        var valid = elems.filter(Boolean);
        if (valid.length === 0) return [];
        _orientDuplexToEdge(valid, p0, p1);
        if (tagName != null) llmTracker.tag(valid, tagName, null, 'duplex');
        render();
        return valid;
    };

    /**
     * Route duplexes along a polyline outline and auto-ligate the vertices.
     *
     * @param {THREE.Vector3[]|number[][]} points  Corner positions.
     * @param {Object} [opts]
     *   {boolean} closed=true     Connect last point back to first.
     *   {string}  seq             Cycled per edge (auto if omitted).
     *   {boolean} isRNA=false
     *   {string}  tag='outline'   Edge tags: tag_e0…; whole shape = alias tag.
     *   {boolean} ligate=true     Auto-connect meeting ends at vertices.
     *   {number}  threshold=1.5   Max end-to-end distance for ligation (units).
     * @returns {BasicElement[]} elems, with .edges=[names], .ligated=n,
     *                           .pairs=[{aId,bId,dist}]
     *
     * Example — duplex triangle, auto-connected:
     *   shapes.outline([new THREE.Vector3(0,0,0), new THREE.Vector3(12,0,0),
     *                   new THREE.Vector3(6,10.4,0)],
     *                  {tag:'tri1'});
     */
    shapes.outline = function(points, opts) {
        opts = opts || {};
        var pts = (points || []).map(function(p) {
            return (p instanceof THREE.Vector3) ? p.clone()
                 : new THREE.Vector3(p[0], p[1], p[2]);
        });
        if (pts.length < 2) {
            notify('shapes.outline: need at least 2 points', 'warning');
            return [];
        }
        var closed = opts.closed !== false;
        var n = closed ? pts.length : pts.length - 1;
        var all = [], edgeNames = [];
        var tag = (opts.tag != null) ? opts.tag : null;
        for (var i = 0; i < n; i++) {
            var e = shapes.duplexEdge(pts[i], pts[(i + 1) % pts.length],
                                      opts.seq || null, opts.isRNA || false, null);
            if (tag) {
                var en = tag + '_e' + i;
                llmTracker.tag(e, en, null, 'edge');
                edgeNames.push(en);
            }
            all = all.concat(e);
        }
        var lig = { ligated: 0, pairs: [] };
        if (opts.ligate !== false && all.length) {
            lig = _ligateEndsGreedy(all, opts.threshold || 1.5, false);
        }
        if (tag) llmTracker.alias(tag, edgeNames);
        else if (all.length) llmTracker.tag(all, 'outline', null, 'wireframe');
        all.edges = edgeNames;
        all.ligated = lig.ligated;
        all.pairs = lig.pairs;
        render();
        return all;
    };

    /**
     * Equilateral duplex triangle (single outline call convenience wrapper).
     *
     * @param {THREE.Vector3} center
     * @param {THREE.Vector3} normal
     * @param {number}  sideLen     Edge length in oxDNA units.
     * @param {string}  [seq]
     * @param {boolean} [isRNA]
     * @param {string}  [tag='triDuplex']
     * @returns {BasicElement[]} (with .edges/.ligated, see outline)
     *
     * Example:
     *   shapes.triangleDuplex(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1),
     *                         12, null, false, 'tri1');
     */
    shapes.triangleDuplex = function(center, normal, sideLen, seq, isRNA, tag) {
        sideLen = sideLen || 12;
        normal = normal ? normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
        var upGuess = (Math.abs(normal.y) < 0.9) ? new THREE.Vector3(0, 1, 0)
                                                  : new THREE.Vector3(1, 0, 0);
        var u = new THREE.Vector3().crossVectors(normal, upGuess).normalize();
        var v = new THREE.Vector3().crossVectors(normal, u).normalize();
        var R = sideLen / Math.sqrt(3); // circumradius
        var pts = [];
        for (var k = 0; k < 3; k++) {
            var th = (2 * Math.PI * k) / 3;
            pts.push(center.clone()
                .addScaledVector(u, Math.cos(th) * R)
                .addScaledVector(v, Math.sin(th) * R));
        }
        return shapes.outline(pts, { tag: (tag != null ? tag : 'triDuplex'),
                                     seq: seq || null, isRNA: isRNA || false });
    };

    /**
     * Pure geometry helper: edge-sharing triangular lattice in a plane.
     * No scene changes — testable, reusable, and handy for custom builders.
     *
     * Basis vectors u,v meet at 60°, so cells V(i,j),V(i+1,j),V(i,j+1) are
     * equilateral. Lattice centroid is placed at `center`.
     *
     * @param {number} nx, ny       Unit cells along u / v (>= 1).
     * @param {number} sideLen      Triangle edge length (oxDNA units).
     * @param {THREE.Vector3} [center]
     * @param {THREE.Vector3} [normal]
     * @returns {{verts: THREE.Vector3[], edges: [[a,b]], cells: [{verts:[a,b,c], up}],
     *            origin, u, v}}
     */
    shapes.triLattice = function(nx, ny, sideLen, center, normal) {
        nx = Math.max(1, nx || 1); ny = Math.max(1, ny || 1);
        sideLen = sideLen || 12;
        center = center ? center.clone() : new THREE.Vector3(0, 0, 0);
        normal = normal ? normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
        var upGuess = (Math.abs(normal.y) < 0.9) ? new THREE.Vector3(0, 1, 0)
                                                  : new THREE.Vector3(1, 0, 0);
        var u = new THREE.Vector3().crossVectors(normal, upGuess).normalize();
        // v = u rotated +60° about normal.
        var v = u.clone().applyAxisAngle
            ? u.clone().applyAxisAngle(normal, Math.PI / 3)
            : u.clone(); // (Vector3.applyAxisAngle always exists in three.js)
        function V(i, j, origin) {
            return origin.clone()
                .addScaledVector(u, i * sideLen)
                .addScaledVector(v, j * sideLen);
        }
        // Raw origin at V(0,0), then recenter on centroid.
        var origin = new THREE.Vector3(0, 0, 0);
        var raw = [];
        for (var j = 0; j <= ny; j++)
            for (var i = 0; i <= nx; i++)
                raw.push(V(i, j, origin));
        var c = new THREE.Vector3(0, 0, 0);
        raw.forEach(function(p) { c.add(p); });
        c.divideScalar(raw.length);
        origin = center.clone().sub(c);
        function idx(i, j) { return j * (nx + 1) + i; }
        var verts = [];
        for (var jj = 0; jj <= ny; jj++)
            for (var ii = 0; ii <= nx; ii++)
                verts.push(V(ii, jj, origin));
        var edgeMap = {}, edges = [];
        function addEdge(a, b) {
            var key = a < b ? a + '-' + b : b + '-' + a;
            if (!edgeMap[key]) { edgeMap[key] = true; edges.push([Math.min(a,b), Math.max(a,b)]); }
        }
        var cells = [];
        for (var cj = 0; cj < ny; cj++) {
            for (var ci = 0; ci < nx; ci++) {
                var a = idx(ci, cj), b = idx(ci + 1, cj), d = idx(ci, cj + 1), e2 = idx(ci + 1, cj + 1);
                var up = [a, b, d], dn = [e2, b, d];
                cells.push({ verts: up, up: true });
                cells.push({ verts: dn, up: false });
                addEdge(a, b); addEdge(b, d); addEdge(d, a);
                addEdge(e2, b); addEdge(b, d); addEdge(d, e2);
            }
        }
        return { verts: verts, edges: edges, cells: cells, origin: origin, u: u, v: v };
    };

    /**
     * Extend edge-sharing triangles into a layered crystal slab.
     *
     * Each layer is a unique-edge triangular lattice (no doubled edges):
     * one duplex per lattice edge, auto-ligated at shared vertices.
     * Layers stack along `normal` with `layerGap` and an optional per-layer
     * twist (screw offset à la tensegrity-triangle R3 stacking, cf. Seeman;
     * Zhang et al. 2018 origami tensegrity triangle).
     *
     * Registry: edges `${tag}_L${l}_e${k}` (kind 'edge'),
     * cells `${tag}_L${l}_c${i}` (aliases of 3 edges),
     * layers `${tag}_L${l}` (aliases of cells),
     * whole crystal `${tag}` (alias of layers).
     *
     * @param {THREE.Vector3} center
     * @param {THREE.Vector3} normal
     * @param {number} sideLen      Triangle edge length (oxDNA units).
     * @param {number} nx, ny       Unit cells per layer.
     * @param {number} nz           Layers.
     * @param {Object} [opts]
     *   {string}  tag='crystal'
     *   {string}  seq / {boolean} isRNA
     *   {number}  layerGap=(sideLen*0.5)   Inter-layer spacing (units).
     *   {number}  twistDeg=0               Extra rotation per layer about normal.
     *   {number[]} shift=[0,0]             Extra in-plane shift per layer (units).
     *   {number}  threshold=2.0            Vertex ligation distance.
     * @returns {BasicElement[]} (.edges/.cells/.layers/.ligated)
     *
     * Example — 2×2×2 crystal of 12-unit triangles:
     *   shapes.triangleCrystal(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1),
     *                          12, 2, 2, 2, {tag:'xtal1'});
     */
    shapes.triangleCrystal = function(center, normal, sideLen, nx, ny, nz, opts) {
        opts = opts || {};
        sideLen = sideLen || 12;
        nx = Math.max(1, nx || 1); ny = Math.max(1, ny || 1); nz = Math.max(1, nz || 1);
        center = center ? center.clone() : new THREE.Vector3(0, 0, 0);
        normal = normal ? normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
        var tag = opts.tag || 'crystal';
        var layerGap = (opts.layerGap != null) ? opts.layerGap : sideLen * 0.5;
        var twistDeg = opts.twistDeg || 0;
        var shift = opts.shift || [0, 0];
        var threshold = opts.threshold || 2.0;

        var upGuess = (Math.abs(normal.y) < 0.9) ? new THREE.Vector3(0, 1, 0)
                                                  : new THREE.Vector3(1, 0, 0);
        var su = new THREE.Vector3().crossVectors(normal, upGuess).normalize();
        var sv = new THREE.Vector3().crossVectors(normal, su).normalize();

        var all = [], layerAliases = [], cellNamesAll = [], edgeNamesAll = [];
        for (var l = 0; l < nz; l++) {
            var lat = shapes.triLattice(nx, ny, sideLen, center, normal);
            var off = normal.clone().multiplyScalar(l * layerGap)
                .addScaledVector(su, (shift[0] || 0) * l)
                .addScaledVector(sv, (shift[1] || 0) * l);
            var tw = (twistDeg * l) * Math.PI / 180;
            var layerCenter = center.clone().add(off);
            var P = lat.verts.map(function(p) {
                var q = p.clone().add(off);
                if (tw) {
                    var rel = q.clone().sub(layerCenter);
                    rel.applyAxisAngle(normal, tw);
                    q = layerCenter.clone().add(rel);
                }
                return q;
            });
            var edgeNames = [], layerElems = [];
            lat.edges.forEach(function(eb, k) {
                var en = tag + '_L' + l + '_e' + k;
                var e = shapes.duplexEdge(P[eb[0]], P[eb[1]],
                                          opts.seq || null, opts.isRNA || false, null);
                llmTracker.tag(e, en, null, 'edge');
                edgeNames.push(en);
                edgeNamesAll.push(en);
                layerElems = layerElems.concat(e);
            });
            var cellNames = [];
            lat.cells.forEach(function(cell, ci) {
                var cn = tag + '_L' + l + '_c' + ci;
                // Cell member edges: find edge names whose endpoint pairs match.
                var want = {};
                [[cell.verts[0], cell.verts[1]],
                 [cell.verts[1], cell.verts[2]],
                 [cell.verts[2], cell.verts[0]]].forEach(function(pr) {
                    var a = Math.min(pr[0], pr[1]), b = Math.max(pr[0], pr[1]);
                    want[a + '-' + b] = true;
                });
                var members = [];
                lat.edges.forEach(function(eb, k) {
                    if (want[eb[0] + '-' + eb[1]]) members.push(edgeNames[k]);
                });
                llmTracker.alias(cn, members);
                cellNames.push(cn);
                cellNamesAll.push(cn);
            });
            var layerAlias = tag + '_L' + l;
            llmTracker.alias(layerAlias, cellNames);
            layerAliases.push(layerAlias);
            all = all.concat(layerElems);
        }
        var lig = { ligated: 0, pairs: [] };
        if (all.length) lig = _ligateEndsGreedy(all, threshold, false);
        llmTracker.alias(tag, layerAliases);
        all.edges = edgeNamesAll;
        all.cells = cellNamesAll;
        all.layers = layerAliases;
        all.ligated = lig.ligated;
        all.pairs = lig.pairs;
        notify('triangleCrystal "' + tag + '": ' + edgeNamesAll.length + ' edges, ' +
               cellNamesAll.length + ' cells, ' + nz + ' layer(s), ' +
               lig.ligated + ' vertex connection(s)', 'success');
        render();
        return all;
    };

    return shapes;

})();
