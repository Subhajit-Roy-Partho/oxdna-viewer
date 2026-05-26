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
 *   shapes.cube(center, sideLen, bpe, seq?, isRNA?, tagName?) → elems
 *   shapes.tetrahedron(center, sideLen, bpe, ...)             → elems
 *   shapes.sphere(center, radius, nBases, ...)                → elems
 *   shapes.helix(center, axis, radius, rise, turns, nBases, ...) → elems
 *   shapes.pointCloud(points, seq?, isRNA?, tagName?)         → elems
 *   shapes.basesForLength(length, spacing?)                   → number
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

    return shapes;

})();
