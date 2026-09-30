/**
 * spatial_api.js — 3-D spatial awareness layer for the LLM agent (and users).
 *
 * Must be loaded AFTER:
 *   dist/api/scene_api.js        (api.*)
 *   dist/api/editing_api.js      (edit.*)
 *   dist/editing/translation.js  (translateElements, rotateElements,
 *                                 rotateElementsByQuaternion, calcsp)
 *   ts/api/transform_api.js      (api.getCOM, api.getPCA, api.rotateGroup)
 *   ts/api/llm_tracker_api.js    (llmTracker)
 *
 * New global exposed: `space`
 *
 * What it provides:
 *  1. A labelled 3-D reference grid (GridHelper + RGB AxesHelper + numeric
 *     tick sprites). 1 cell = 3 oxDNA units ≈ 2.5 nm ≈ one duplex diameter,
 *     so the LLM can reason in "helix steps". Extent auto-fits the scene.
 *  2. A per-turn scene digest (space.describe / space.digest): every named
 *     object with nucleotide count, centroid, bbox, size, principal axis
 *     and colour — the symbolic spatial facts the LLM actually needs
 *     (cf. the 2026 coding-agent-for-caDNAno result: LLMs cannot reason
 *     about raw 3-D coordinates; give them derived facts instead).
 *  3. Object-addressed transforms (moveTo/moveBy/rotate/align/place/duplicate/
 *     snapToGrid) that survive the per-block `new Function()` scope reset
 *     because they address objects by registry NAME, not JS variable.
 *  4. Spatial queries: distance/gap/overlaps/angleBetween/nearestEnd.
 *  5. Connection helpers: findNicks (5'/3' end pairs within a threshold) +
 *     ligateNearby (auto-connect outline edges / crystal vertices).
 *  6. Inspection helpers: select/focus/frameAll/snapshotImage/show, plus the
 *     backing functions for the Structure Ledger window
 *     (ledgerSetup/ledgerRefresh/ledgerSelect/ledgerFocus as globals).
 *
 * Quick reference:
 *   space.grid(on?, {size, offset, normal}) / space.toggleGrid()          → reference grid + XYZ axes
 *   space.describe()                              → text digest of every object
 *   space.digest()                                → structured JSON-safe digest
 *   space.list()                                  → [names]
 *   space.info(name)                              → full live record | null
 *   space.get(name)                               → BasicElement[]
 *   space.centroid(name) / space.bbox(name) / space.size(name) / space.axis(name)
 *   space.moveTo(name, x, y, z) / space.moveBy(name, dx, dy, dz)
 *   space.rotate(name, axis, deg, pivot?)
 *   space.align(name, localAxis?, worldDir)       → principal axis → worldDir
 *   space.place(name, {near, dir, gap})
 *   space.snapToGrid(name, cell?)                 → centroid snapped to grid
 *   space.duplicate(name, {offset?, newName?})
 *   space.rename(oldName, newName) / space.deleteObject(name)
 *   space.select(name, keepPrev?) / space.focus(name) / space.frameAll()
 *   space.listClusters()                          → [{id, label, size}] (native clusters, any source)
 *   space.selectCluster(id, keepPrev?) / space.nameCluster(id, name)
 *   space.clusterSelection(name?)                 → selection to cluster (+name), returns id
 *   space.autoClusterRigidDna()                   → async rigidDNA helix-geometry clustering
 *   space.relaxRigidDna(opts?)                    → async rigidDNA relax + apply (headless)
 *   space.distance(a,b) / space.gap(a,b) / space.overlaps(a,b)
 *   space.angleBetween(a,b)                       → degrees between PCA axes
 *   space.findNicks(threshold?)                   → [{aId,bId,dist}]
 *   space.ligateNearby(threshold?, opts?)         → {ligated, pairs}
 *   space.countAll() / space.exportScene()
 *   space.snapshotImage(scale?)                   → PNG dataURL | null
 *   space.show(name?)                             → snapshot in chat (+focus)
 *
 * An "object" is: an llmTracker name (or group alias), a numeric clusterId,
 * a 'cluster7'-style native-cluster name, 'selection', 'system0'/'system1'… or 'all'.
 */

window.space = (function() {

    // ── constants ──────────────────────────────────────────────────────────────
    // 1 oxDNA unit ≈ 0.85 nm; duplex diameter ≈ 2.5 nm ≈ 3 units.
    var GRID_CELL = 3;
    var GRID_MIN_EXTENT = 60;
    var GRID_MAX_DIVISIONS = 60;
    var AXIS_COLORS = { x: '#ff5555', y: '#55ff55', z: '#5599ff' };

    var _gridGroup = null;
    var _gridVisible = false;
    var _gridSize = 0;      // extent in oxDNA units; 0 = auto-fit to scene
    var _gridOffset = 0;    // shift of the grid plane along its normal; default 0
    var _gridNormal = 'y';  // grid plane normal: 'x' | 'y' (classic ground plane) | 'z'

    // ── small utilities ────────────────────────────────────────────────────────

    function _r1(v) { return Math.round(v * 10) / 10; }

    function _asVec(a) {
        if (a instanceof THREE.Vector3) return a.clone();
        if (typeof a === 'string') {
            var s = a.toLowerCase();
            if (s === 'x') return new THREE.Vector3(1, 0, 0);
            if (s === 'y') return new THREE.Vector3(0, 1, 0);
            if (s === 'z') return new THREE.Vector3(0, 0, 1);
            if (s === '-x') return new THREE.Vector3(-1, 0, 0);
            if (s === '-y') return new THREE.Vector3(0, -1, 0);
            if (s === '-z') return new THREE.Vector3(0, 0, -1);
            if (s === 'origin') return new THREE.Vector3(0, 0, 0);
        }
        if (Array.isArray(a) && a.length === 3) return new THREE.Vector3(a[0], a[1], a[2]);
        return null;
    }

    function _allMonomers() {
        var all = [];
        try {
            systems.forEach(function(sys) {
                try { sys.getMonomers().forEach(function(e) { all.push(e); }); } catch(_) {}
            });
        } catch(_) {}
        return all;
    }

    /**
     * Resolve an object name to elements.
     * Accepts: tracker name / alias, numeric clusterId, 'selection',
     * 'system0..N', 'all'.
     */
    function _resolve(name) {
        if (name == null) return [];
        if (typeof name === 'number') {
            return _allMonomers().filter(function(e) { return e.clusterId === name; });
        }
        if (typeof name !== 'string') {
            if (Array.isArray(name)) return name;
            return [];
        }
        var s = name.trim();
        if (s === 'selection') {
            try { return Array.from(selectedBases); } catch(_) { return []; }
        }
        if (s === 'all') return _allMonomers();
        var m = s.match(/^system(\d+)$/i);
        if (m) {
            try {
                var sys = systems[parseInt(m[1], 10)];
                return sys ? sys.getMonomers() : [];
            } catch(_) { return []; }
        }
        // Native cluster ids, e.g. the 'cluster7' rows space.digest() emits
        // for untracked clusters. Checked AFTER llmTracker below, so a tag
        // literally named 'cluster7' still resolves to the tag.
        var cm = s.match(/^cluster(\d+)$/i);
        var clusterIdMatch = cm ? parseInt(cm[1], 10) : null;
        try {
            if (window.llmTracker) {
                var tagged = llmTracker.getByName(s);
                if (tagged && tagged.length) return tagged;
            }
        } catch(_) {}
        if (clusterIdMatch != null) {
            return _allMonomers().filter(function(e) { return e.clusterId === clusterIdMatch; });
        }
        return [];
    }

    function _bboxOf(elems) {
        var min = new THREE.Vector3(Infinity, Infinity, Infinity);
        var max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        var n = 0;
        elems.forEach(function(e) {
            var p;
            try { p = e.getPos(); } catch(_) { return; }
            if (!p) return;
            n++;
            if (p.x < min.x) min.x = p.x; if (p.y < min.y) min.y = p.y; if (p.z < min.z) min.z = p.z;
            if (p.x > max.x) max.x = p.x; if (p.y > max.y) max.y = p.y; if (p.z > max.z) max.z = p.z;
        });
        return n ? { min: min, max: max, count: n } : null;
    }

    function _centroidOf(elems) {
        try {
            if (typeof api !== 'undefined' && api.getCOM && elems.length) return api.getCOM(elems);
        } catch(_) {}
        var bb = _bboxOf(elems);
        return bb ? bb.min.clone().add(bb.max).divideScalar(2) : new THREE.Vector3(0, 0, 0);
    }

    function _axisOf(elems) {
        try {
            if (typeof api !== 'undefined' && api.getPCA && elems.length >= 3) {
                var pca = api.getPCA(elems);
                if (pca && pca.primaryAxis) return pca.primaryAxis.clone();
            }
        } catch(_) {}
        var bb = _bboxOf(elems);
        if (!bb) return new THREE.Vector3(0, 0, 1);
        var s = bb.max.clone().sub(bb.min);
        return (s.x >= s.y && s.x >= s.z) ? new THREE.Vector3(1, 0, 0)
             : (s.y >= s.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1));
    }

    function _colorOf(elems) {
        for (var i = 0; i < elems.length; i++) {
            try {
                var c = elems[i].color;
                if (c && typeof c.getHexString === 'function') return '#' + c.getHexString();
            } catch(_) {}
        }
        return null;
    }

    function _flush(elems) {
        if (!elems || !elems.length) return;
        try {
            var sys = elems[0].dummySys || elems[0].getSystem();
            if (sys && sys.callAllUpdates) sys.callAllUpdates();
        } catch(_) {}
        try { render(); } catch(_) {}
    }

    // ── reference grid ─────────────────────────────────────────────────────────
    // three.js convention: Red=X, Green=Y, Blue=Z. Cell = duplex diameter so
    // "move 1 cell" ≈ "move one helix over".

    function _textSprite(text, color) {
        try {
            var c = document.createElement('canvas');
            c.width = 160; c.height = 80;
            var g = c.getContext('2d');
            g.font = 'bold 34px sans-serif';
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillStyle = color || '#ffffff';
            g.fillText(text, 80, 40);
            var tex = new THREE.CanvasTexture(c);
            var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
            sp.scale.set(7, 3.5, 1);
            return sp;
        } catch(_) { return null; }
    }

    function _sceneBox() {
        var bb = _bboxOf(_allMonomers());
        if (!bb) {
            var h = GRID_MIN_EXTENT / 2;
            return { min: new THREE.Vector3(-h, -h, -h), max: new THREE.Vector3(h, h, h) };
        }
        return bb;
    }

    function _normGridNormal(n) {
        var s = String(n == null ? 'y' : n).toLowerCase();
        return (s === 'x' || s === 'z') ? s : 'y';
    }

    function _buildGrid() {
        _removeGrid();
        var bb = _sceneBox();
        var size = bb.max.clone().sub(bb.min);
        var extent;
        if (_gridSize > 0) {
            extent = _gridSize;
        } else {
            var maxDim = Math.max(size.x, size.z, GRID_MIN_EXTENT);
            extent = Math.ceil(maxDim / GRID_CELL) * GRID_CELL;
        }
        var divisions = Math.min(Math.max(1, Math.round(extent / GRID_CELL)), GRID_MAX_DIVISIONS);
        var cell = extent / divisions;

        _gridGroup = new THREE.Group();
        _gridGroup.name = 'spaceGrid';
        // GridHelper lies in XZ (normal +Y); rotate the group 90° to get
        // a YZ (normal X) or XY (normal Z) plane.
        if (_gridNormal === 'x') _gridGroup.rotation.z = Math.PI / 2;
        else if (_gridNormal === 'z') _gridGroup.rotation.x = Math.PI / 2;

        var grid = new THREE.GridHelper(extent, divisions, 0x888888, 0x444444);
        _gridGroup.add(grid);

        var axes = new THREE.AxesHelper(extent / 2);
        _gridGroup.add(axes);

        // Numeric tick labels along X and Z (every k-th line, signed numbers).
        var step = Math.max(1, Math.floor(divisions / 10));
        for (var i = -divisions / 2; i <= divisions / 2; i += step) {
            var v = Math.round(i * cell);
            var lx = _textSprite('X:' + (v >= 0 ? '+' : '') + v, AXIS_COLORS.x);
            if (lx) { lx.position.set(i * cell, 0.5, 0); _gridGroup.add(lx); }
            var lz = _textSprite('Z:' + (v >= 0 ? '+' : '') + v, AXIS_COLORS.z);
            if (lz) { lz.position.set(0, 0.5, i * cell); _gridGroup.add(lz); }
        }
        var yo = _textSprite(_gridNormal.toUpperCase() + ' up', AXIS_COLORS[_gridNormal]);
        if (yo) { yo.position.set(0, extent / 4, 0); _gridGroup.add(yo); }

        // Sit just under the scene, centred on it; offset shifts the plane
        // along its normal. Local +Y of the group is the plane normal, so
        // the offset rides the group's rotation automatically.
        var cx = (bb.min.x + bb.max.x) / 2;
        var cy = (bb.min.y + bb.max.y) / 2;
        var cz = (bb.min.z + bb.max.z) / 2;
        if (_gridNormal === 'x') _gridGroup.position.set(bb.min.x - GRID_CELL + _gridOffset, cy, cz);
        else if (_gridNormal === 'z') _gridGroup.position.set(cx, cy, bb.min.z - GRID_CELL + _gridOffset);
        else _gridGroup.position.set(cx, bb.min.y - GRID_CELL + _gridOffset, cz);
        try {
            scene.add(_gridGroup);
            render();
        } catch (err) {
            notify('space.grid: could not add grid (' + err.message + ')', 'warning');
        }
    }

    function _removeGrid() {
        if (_gridGroup) {
            try { scene.remove(_gridGroup); } catch(_) {}
            _gridGroup = null;
            try { render(); } catch(_) {}
        }
    }

    // ── digest ─────────────────────────────────────────────────────────────────

    function _recordFor(name, elems) {
        var bb = _bboxOf(elems);
        var c = _centroidOf(elems);
        var ax = _axisOf(elems);
        return {
            name: name,
            count: elems.length,
            centroid: [_r1(c.x), _r1(c.y), _r1(c.z)],
            bbox: bb ? {
                min: [_r1(bb.min.x), _r1(bb.min.y), _r1(bb.min.z)],
                max: [_r1(bb.max.x), _r1(bb.max.y), _r1(bb.max.z)]
            } : null,
            size: bb ? [_r1(bb.max.x - bb.min.x), _r1(bb.max.y - bb.min.y), _r1(bb.max.z - bb.min.z)] : null,
            axis: [_r1(ax.x), _r1(ax.y), _r1(ax.z)],
            color: _colorOf(elems)
        };
    }

    // ── public API ─────────────────────────────────────────────────────────────

    var space = {};

    // ── grid ──

    /**
     * Show (on=true), hide (on=false) or toggle (omitted) the reference grid.
     * Rebuilt from the live scene bbox on every show, so it always fits.
     * opts (optional): {size?, offset?, normal?} — size is the grid extent in
     * oxDNA units (0/omitted = auto-fit), offset shifts the plane along its
     * normal (default 0), normal is 'x'|'y'|'z' (default 'y', classic ground
     * plane; 'x'/'z' rotate the helper group 90°). Passing opts rebuilds the
     * grid live when visible. The first argument may also be the opts object
     * itself (implies on=true).
     * Keeps the View-menu "Grid" switch (#gridToggle) in sync when present,
     * so chat auto-show (llm_chat/agent_chat) and the Structure Ledger
     * toggle button don't leave the checkbox lying.
     */
    space.grid = function(on, opts) {
        if (on != null && typeof on === 'object') { opts = on; on = true; }
        if (on == null) on = !_gridVisible;
        opts = opts || {};
        if (opts.size != null) {
            var sz = parseFloat(opts.size);
            _gridSize = (isFinite(sz) && sz > 0) ? sz : 0;
        }
        if (opts.offset != null) {
            var off = parseFloat(opts.offset);
            _gridOffset = isFinite(off) ? off : 0;
        }
        if (opts.normal != null) _gridNormal = _normGridNormal(opts.normal);
        _gridVisible = !!on;
        if (_gridVisible) _buildGrid();
        else _removeGrid();
        try {
            var cb = document.getElementById('gridToggle');
            if (cb) cb.checked = _gridVisible;
            var si = document.getElementById('gridSize');
            if (si) si.value = _gridSize;
            var oi = document.getElementById('gridOffset');
            if (oi) oi.value = _gridOffset;
            var ns = document.getElementById('gridNormal');
            if (ns) ns.value = _gridNormal;
        } catch(_) {}
        return _gridVisible;
    };

    /** Toggle the reference grid (keeps current size/offset/normal). */
    space.toggleGrid = function() { return space.grid(!_gridVisible); };

    /** Current grid state. */
    space.gridState = function() {
        return { visible: _gridVisible, cell: GRID_CELL, cellNm: 2.5,
                 size: _gridSize, offset: _gridOffset, normal: _gridNormal };
    };

    // ── digest / describe ──

    /**
     * Structured, JSON-safe digest of the whole scene:
     * { objects: [{name,count,centroid,bbox,size,axis,color,kind?}],
     *   box, grid, hint }
     */
    space.digest = function() {
        var objects = [];
        var seen = {};
        try {
            if (window.llmTracker) {
                llmTracker.listDetailed().forEach(function(r) {
                    seen[r.name] = true;
                    objects.push({
                        name: r.name, kind: r.kind || 'shape',
                        count: r.count, centroid: r.centroid,
                        bbox: r.bbox, size: r.size,
                        axis: r.direction, color: r.color,
                        members: r.members || undefined,
                        clusterId: (r.clusterId == null ? undefined : r.clusterId)
                    });
                });
            }
        } catch(_) {}
        // Untracked clusters still get a row so nothing is invisible to the LLM.
        try {
            var untracked = {};
            _allMonomers().forEach(function(e) {
                if (e.clusterId == null || e.clusterId < 0) return;
                var known = false;
                try {
                    known = window.llmTracker &&
                        llmTracker.list().some(function(t) { return t.clusterId === e.clusterId; });
                } catch(_) {}
                if (!known) {
                    (untracked[e.clusterId] = untracked[e.clusterId] || []).push(e);
                }
            });
            Object.keys(untracked).forEach(function(cid) {
                var nm = 'cluster' + cid;
                if (seen[nm]) return;
                var rec = _recordFor(nm, untracked[cid]);
                rec.kind = 'untracked';
                rec.clusterId = parseInt(cid, 10);
                objects.push(rec);
            });
        } catch(_) {}
        var boxArr = null;
        try { if (typeof box !== 'undefined' && box) boxArr = [_r1(box.x), _r1(box.y), _r1(box.z)]; } catch(_) {}
        return {
            objects: objects,
            box: boxArr,
            grid: { visible: _gridVisible, cell: GRID_CELL, cellNm: 2.5,
                    size: _gridSize, offset: _gridOffset, normal: _gridNormal },
            hint: 'Units are oxDNA units (1 unit ≈ 0.85 nm). Grid cell = 3 units ≈ one duplex diameter.'
        };
    };

    /**
     * One-line-per-object text digest, injected into the LLM prompt every turn.
     */
    space.describe = function() {
        var d = space.digest();
        if (!d.objects.length) {
            return 'Scene: (empty — no structures loaded)' + (d.grid.visible ? ' Grid ON.' : ' Grid OFF — space.grid(true) to show it.');
        }
        var lines = d.objects.map(function(o) {
            var pos = o.centroid ? ('pos=(' + o.centroid.join(',') + ')') : 'pos=(?)';
            var sz = o.size ? ('size=(' + o.size.join(',') + ')') : '';
            var ax = o.axis ? ('axis=(' + o.axis.join(',') + ')') : '';
            var bb = o.bbox ? ('x[' + o.bbox.min[0] + ',' + o.bbox.max[0] + '] y[' + o.bbox.min[1] + ',' + o.bbox.max[1] + '] z[' + o.bbox.min[2] + ',' + o.bbox.max[2] + ']') : '';
            return '  - "' + o.name + '" [' + (o.kind || 'shape') + '] n=' + o.count + ' ' + pos + ' ' + sz + ' ' + ax + ' ' + bb;
        });
        return 'Scene (' + d.objects.length + ' object(s), grid ' + (d.grid.visible ? 'ON, cell=3u' : 'OFF') + '):\n' + lines.join('\n');
    };

    /** Names of all known objects (tracked + untracked clusters). */
    space.list = function() {
        return space.digest().objects.map(function(o) { return o.name; });
    };

    /**
     * Full live record for one object, or null if unknown.
     * Merges tracker metadata (kind, members) with live spatial stats.
     */
    space.info = function(name) {
        var elems = _resolve(name);
        if (!elems.length) return null;
        var rec = _recordFor(String(name), elems);
        try {
            if (window.llmTracker) {
                var t = llmTracker.info(String(name));
                if (t) { rec.kind = t.kind; rec.members = t.members || undefined; rec.clusterId = t.clusterId; }
            }
        } catch(_) {}
        if (rec.kind == null) {
            rec.kind = (typeof name === 'number' || /^cluster\d+$/.test(String(name))) ? 'untracked' : 'shape';
        }
        return rec;
    };

    // ── element access ──

    /** Elements of an object. */
    space.get = function(name) { return _resolve(name); };

    /** Centroid (THREE.Vector3) of an object. */
    space.centroid = function(name) { return _centroidOf(_resolve(name)); };

    /** {min,max} bbox (THREE.Vector3 pair) of an object, or null. */
    space.bbox = function(name) {
        var bb = _bboxOf(_resolve(name));
        return bb ? { min: bb.min, max: bb.max } : null;
    };

    /** [sx,sy,sz] bbox size of an object, or null. */
    space.size = function(name) {
        var bb = _bboxOf(_resolve(name));
        return bb ? [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z] : null;
    };

    /** Principal (PCA) axis (THREE.Vector3) of an object. */
    space.axis = function(name) { return _axisOf(_resolve(name)); };

    // ── transforms (all by name) ──

    /** Move an object so its centroid lands at (x,y,z). */
    space.moveTo = function(name, x, y, z) {
        var elems = _resolve(name);
        if (!elems.length) { notify('space.moveTo: "' + name + '" not found', 'warning'); return; }
        var c = _centroidOf(elems);
        translateElements(new Set(elems), new THREE.Vector3(x - c.x, y - c.y, z - c.z));
        _flush(elems);
    };

    /** Move an object by (dx,dy,dz). */
    space.moveBy = function(name, dx, dy, dz) {
        var elems = _resolve(name);
        if (!elems.length) { notify('space.moveBy: "' + name + '" not found', 'warning'); return; }
        translateElements(new Set(elems), new THREE.Vector3(dx, dy, dz));
        _flush(elems);
    };

    /**
     * Rotate an object by deg around axis ('x'|'y'|'z'|[x,y,z]|Vector3).
     * pivot: undefined (object centroid) | 'origin' | [x,y,z] | other object name.
     */
    space.rotate = function(name, axis, deg, pivot) {
        var elems = _resolve(name);
        if (!elems.length) { notify('space.rotate: "' + name + '" not found', 'warning'); return; }
        var ax = _asVec(axis) || new THREE.Vector3(0, 1, 0);
        var pv;
        if (pivot == null) pv = _centroidOf(elems);
        else if (typeof pivot === 'string' && pivot !== 'origin') {
            var pe = _resolve(pivot);
            pv = pe.length ? _centroidOf(pe) : _centroidOf(elems);
        } else pv = _asVec(pivot) || new THREE.Vector3(0, 0, 0);
        try {
            if (typeof api !== 'undefined' && api.rotateGroup) api.rotateGroup(elems, ax, deg, pv);
            else rotateElements(new Set(elems), ax.clone().normalize(), deg * Math.PI / 180, pv);
        } catch (err) {
            notify('space.rotate failed: ' + err.message, 'warning');
            return;
        }
        _flush(elems);
    };

    /**
     * Rotate an object so its principal axis points along worldDir
     * ('x'|'y'|'z'|'-x'|…|[x,y,z]). localAxis is accepted for future use and
     * currently means the principal (PCA) axis.
     */
    space.align = function(name, localAxis, worldDir) {
        if (worldDir == null && localAxis != null && (Array.isArray(localAxis) || typeof localAxis === 'string')) {
            // Called as align(name, worldDir).
            worldDir = localAxis;
        }
        var elems = _resolve(name);
        if (!elems.length) { notify('space.align: "' + name + '" not found', 'warning'); return; }
        var want = _asVec(worldDir);
        if (!want) { notify('space.align: bad worldDir', 'warning'); return; }
        want.normalize();
        var cur = _axisOf(elems);
        if (cur.dot(want) < 0) cur.negate(); // take the shorter rotation
        var q = new THREE.Quaternion().setFromUnitVectors(cur.clone().normalize(), want);
        rotateElementsByQuaternion(new Set(elems), q, _centroidOf(elems));
        _flush(elems);
    };

    /**
     * Move object `name` so its bbox sits `gap` units from object `near`
     * along `dir` ('x'|'-x'|'y'|'-y'|'z'|'-z'|[x,y,z]).
     * Example: space.place('cubeB', {near:'starA', dir:'x', gap:3});
     */
    space.place = function(name, opts) {
        opts = opts || {};
        var elems = _resolve(name), ref = _resolve(opts.near);
        if (!elems.length) { notify('space.place: "' + name + '" not found', 'warning'); return; }
        if (!ref.length) { notify('space.place: reference "' + opts.near + '" not found', 'warning'); return; }
        var dir = _asVec(opts.dir || 'x');
        if (!dir) { notify('space.place: bad dir', 'warning'); return; }
        dir.normalize();
        var gap = (opts.gap == null) ? 2 : opts.gap;
        var A = _bboxOf(elems), B = _bboxOf(ref);
        // Support only axis-dominant dirs for bbox-face placement.
        var ax = Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z) ? 'x'
               : (Math.abs(dir.y) >= Math.abs(dir.z) ? 'y' : 'z');
        var sgn = dir[ax] >= 0 ? 1 : -1;
        var target, face;
        if (sgn > 0) { target = B.max[ax] + gap; face = A.min[ax]; }
        else { target = B.min[ax] - gap; face = A.max[ax]; }
        var shift = new THREE.Vector3(0, 0, 0);
        shift[ax] = target - face;
        translateElements(new Set(elems), shift);
        _flush(elems);
    };

    /**
     * Snap an object's centroid to the reference grid lattice (default cell 3).
     * Keeps hand-placed structures on integer helix-steps.
     */
    space.snapToGrid = function(name, cell) {
        cell = cell || GRID_CELL;
        var elems = _resolve(name);
        if (!elems.length) { notify('space.snapToGrid: "' + name + '" not found', 'warning'); return; }
        var c = _centroidOf(elems);
        var t = new THREE.Vector3(
            Math.round(c.x / cell) * cell,
            Math.round(c.y / cell) * cell,
            Math.round(c.z / cell) * cell
        );
        translateElements(new Set(elems), t.sub(c));
        _flush(elems);
    };

    /**
     * Duplicate an object via InstanceCopy + addElementsAt, translate by
     * offset ([dx,dy,dz], default [10,0,0]) and tag the copy as newName
     * (default "<name>_copy").
     */
    space.duplicate = function(name, opts) {
        opts = opts || {};
        var elems = _resolve(name);
        if (!elems.length) { notify('space.duplicate: "' + name + '" not found', 'warning'); return null; }
        var off = opts.offset || [10, 0, 0];
        var ov = _asVec(off) || new THREE.Vector3(10, 0, 0);
        var newName = opts.newName || (String(name) + '_copy');
        var copies;
        try {
            copies = elems.map(function(e) { return new InstanceCopy(e); });
        } catch (err) {
            notify('space.duplicate: InstanceCopy failed (' + err.message + ')', 'warning');
            return null;
        }
        var added;
        try {
            added = (typeof edit !== 'undefined' && edit.addElementsAt)
                ? edit.addElementsAt(copies)
                : edit.addElements(copies);
        } catch (err) {
            notify('space.duplicate: addElements failed (' + err.message + ')', 'warning');
            return null;
        }
        var valid = (added || []).filter(Boolean);
        if (!valid.length) { notify('space.duplicate: nothing added', 'warning'); return null; }
        translateElements(new Set(valid), ov);
        // New cluster for the copy.
        clusterCounter++;
        var cid = clusterCounter;
        valid.forEach(function(e) { e.clusterId = cid; });
        try {
            if (window.llmTracker) {
                // Register directly (elements already carry the new clusterId).
                llmTracker.tag(valid, newName, null, 'copy');
            }
        } catch(_) {}
        _flush(valid);
        return valid;
    };

    /** Rename a tracked object (delegates to llmTracker). */
    space.rename = function(oldName, newName) {
        try { llmTracker.rename(oldName, newName); }
        catch (err) { notify('space.rename failed: ' + err.message, 'warning'); }
    };

    /** Delete a tracked object incl. group aliases (delegates to llmTracker). */
    space.deleteObject = function(name) {
        try { llmTracker.deleteByName(name); }
        catch (err) { notify('space.deleteObject failed: ' + err.message, 'warning'); }
    };

    // ── native clusters (numeric clusterId system + user labels) ──

    /**
     * List every native cluster in the scene: [{id, label, size}].
     * Labels are the user-assigned names from the Clustering window
     * (renameCluster), or 'Cluster <id>' when unnamed. This covers clusters
     * from ANY source (DBSCAN, rigidDNA auto-cluster, manual selection) --
     * not just llmTracker tags.
     */
    space.listClusters = function() {
        try {
            if (typeof listClusters === 'function') return listClusters();
        } catch(_) {}
        var sizes = {};
        _allMonomers().forEach(function(e) {
            if (typeof e.clusterId === 'number' && e.clusterId >= 0) {
                sizes[e.clusterId] = (sizes[e.clusterId] || 0) + 1;
            }
        });
        return Object.keys(sizes).map(function(id) {
            var label = null;
            try {
                label = (typeof getClusterLabel === 'function')
                    ? getClusterLabel(parseInt(id, 10)) : null;
            } catch(_) {}
            return { id: parseInt(id, 10), label: label || ('Cluster ' + id), size: sizes[id] };
        });
    };

    /** Select every element of one native cluster id (keepPrev accumulates). */
    space.selectCluster = function(id, keepPrev) {
        try {
            if (typeof selectCluster === 'function') { selectCluster(id, keepPrev); return; }
        } catch(_) {}
        space.select(typeof id === 'number' ? ('cluster' + id) : id, keepPrev);
    };

    /** Rename a native cluster (same store as the Clustering window list). */
    space.nameCluster = function(id, name) {
        try {
            if (typeof renameCluster === 'function') return renameCluster(id, name);
        } catch(_) {}
        notify('space.nameCluster: renameCluster not available', 'warning');
        return false;
    };

    /**
     * Turn the current selection into a new cluster (selectionToCluster),
     * optionally tag + name it for later object-addressed use.
     * Returns the new cluster id (or null when nothing was selected).
     */
    space.clusterSelection = function(name) {
        var sel = [];
        try { sel = Array.from(selectedBases); } catch(_) {}
        if (!sel.length) { notify('space.clusterSelection: nothing selected', 'warning'); return null; }
        try {
            if (typeof selectionToCluster === 'function') selectionToCluster();
            else {
                clusterCounter++;
                sel.forEach(function(e) { e.clusterId = clusterCounter; });
            }
        } catch (err) { notify('space.clusterSelection failed: ' + err.message, 'warning'); return null; }
        var cid = clusterCounter;
        if (name) space.nameCluster(cid, name);
        return cid;
    };

    // ── rigidDNA relaxation (headless: no window DOM needed) ──

    /**
     * Auto-cluster from helix geometry (same engine as the rigidDNA
     * window's 'Auto-cluster (rigidDNA)' button). Async -- resolves to the
     * cluster summary string, or null on failure.
     */
    space.autoClusterRigidDna = async function() {
        try {
            if (typeof runRigidDnaAutoCluster !== 'function') {
                notify('space.autoClusterRigidDna: rigidDNA engine not loaded', 'warning');
                return null;
            }
            await runRigidDnaAutoCluster();
            return (typeof rigidDnaClusterSummary === 'function') ? rigidDnaClusterSummary() : null;
        } catch (err) {
            notify('space.autoClusterRigidDna failed: ' + err.message, 'warning');
            return null;
        }
    };

    /**
     * Run rigidDNA rigid-body relaxation headless (WASM, in-browser) and
     * apply the relaxed positions to the live scene -- the same computation
     * as the rigidDNA window's 'Run rigidDNA Relaxation' button, but driven
     * by `opts` instead of the window's form fields (the form may not even
     * be loaded). Always a single continuous run. Async -- resolves true
     * on success, false on failure.
     *
     * opts: {steps?, dt?, k?, b?, repulsion?, repulsionOffset?,
     *        repulsionEnd?, bondDistance?, bondDistanceEnd?, planar?, ...} -- any
     *        RigidDnaRelaxOptions key; omitted keys use the engine defaults
     *        (steps defaults to 2000, bondDistance defaults to 0.7 -- close
     *        to the real ~0.75su backbone bond -- matching the rigidDNA
     *        window). Pass repulsionEnd to ramp repulsion down over the run.
     * Clusters used are the scene's current element.clusterId assignments
     * (unclustered particles relax as singletons).
     *
     * Example: await space.relaxRigidDna({steps: 500});
     */
    space.relaxRigidDna = async function(opts) {
        try {
            if (typeof exportSceneForRigidDna !== 'function' ||
                !window.RigidDnaBridge || typeof RigidDnaBridge.relax !== 'function') {
                notify('space.relaxRigidDna: rigidDNA engine not loaded', 'warning');
                return false;
            }
            if (typeof elements !== 'undefined' && elements.size === 0) {
                notify('space.relaxRigidDna: scene is empty', 'warning');
                return false;
            }
            var relaxOpts = {};
            if (opts) {
                Object.keys(opts).forEach(function(k) {
                    if (opts[k] !== undefined && opts[k] !== null) relaxOpts[k] = opts[k];
                });
            }
            if (relaxOpts.steps == null) relaxOpts.steps = 2000;
            if (relaxOpts.bondDistance == null) relaxOpts.bondDistance = 0.7;
            notify('Running rigidDNA relaxation (WASM, ' + relaxOpts.steps + ' steps)...');
            var exp = exportSceneForRigidDna();
            var result = await RigidDnaBridge.relax(exp.topText, exp.datText, relaxOpts);
            if (!result || !result.ok || !result.lastConf) {
                notify('rigidDNA relaxation failed: ' + ((result && result.error) || 'unknown error'), 'alert');
                return false;
            }
            applyRigidDnaConf(result.lastConf, exp.newElementIDs);
            notify('rigidDNA relaxation complete -- structure updated.', 'info');
            return true;
        } catch (err) {
            notify('space.relaxRigidDna failed: ' + err.message, 'warning');
            return false;
        }
    };

    // ── selection / camera ──

    /** Select an object (keepPrev=true accumulates). */
    space.select = function(name, keepPrev) {
        var elems = _resolve(name);
        if (!elems.length) { notify('space.select: "' + name + '" not found', 'warning'); return; }
        api.selectElements(elems, keepPrev);
    };

    /** Select + fly the camera to an object so the user can inspect the region. */
    space.focus = function(name) {
        var elems = _resolve(name);
        if (!elems.length) { notify('space.focus: "' + name + '" not found', 'warning'); return; }
        try {
            api.selectElements(elems);
            api.findElement(elems[0]);
            notify('Focused "' + name + '" (' + elems.length + ' nt)', 'info');
        } catch (err) {
            notify('space.focus failed: ' + err.message, 'warning');
        }
    };

    /** Frame every nucleotide in the scene (fit-all view). */
    space.frameAll = function() {
        var all = _allMonomers();
        if (!all.length) { notify('space.frameAll: scene empty', 'warning'); return; }
        var bb = _bboxOf(all);
        var c = bb.min.clone().add(bb.max).divideScalar(2);
        var r = bb.max.clone().sub(bb.min).length() / 2;
        try {
            var dir;
            try {
                var tgt = (typeof controls !== 'undefined' && controls.target) ? controls.target.clone() : c.clone();
                dir = camera.position.clone().sub(tgt);
            } catch(_) { dir = new THREE.Vector3(1, 0.6, 1); }
            if (dir.lengthSq() < 1e-6) dir.set(1, 0.6, 1);
            dir.normalize();
            camera.position.copy(c.clone().addScaledVector(dir, Math.max(r * 3, 30)));
            try { if (typeof controls !== 'undefined' && controls.target) controls.target.copy(c); } catch(_) {}
            render();
        } catch (err) {
            notify('space.frameAll failed: ' + err.message, 'warning');
        }
    };

    // ── spatial queries ──

    /** Centroid-to-centroid distance between two objects. */
    space.distance = function(a, b) {
        var ea = _resolve(a), eb = _resolve(b);
        if (!ea.length || !eb.length) { notify('space.distance: object not found', 'warning'); return null; }
        return _centroidOf(ea).distanceTo(_centroidOf(eb));
    };

    /**
     * Minimum bbox-to-bbox gap (positive = separated, negative = overlap depth).
     * Computed as the AABB separation distance, negated penetration when overlapping.
     */
    space.gap = function(a, b) {
        var A = _bboxOf(_resolve(a)), B = _bboxOf(_resolve(b));
        if (!A || !B) { notify('space.gap: object not found', 'warning'); return null; }
        var axes = ['x', 'y', 'z'];
        var sep2 = 0, overlap = true, minPen = Infinity;
        for (var i = 0; i < 3; i++) {
            var ax = axes[i];
            var s = Math.max(B.min[ax] - A.max[ax], A.min[ax] - B.max[ax]);
            if (s > 0) { overlap = false; sep2 += s * s; }
            else {
                var pen = Math.min(A.max[ax] - B.min[ax], B.max[ax] - A.min[ax]);
                if (pen < minPen) minPen = pen;
            }
        }
        return overlap ? -minPen : Math.sqrt(sep2);
    };

    /** True when the two objects' bounding boxes intersect (with small epsilon). */
    space.overlaps = function(a, b) {
        var g = space.gap(a, b);
        return g == null ? null : g < 1e-6;
    };

    /** Angle in degrees between the principal axes of two objects. */
    space.angleBetween = function(a, b) {
        var ea = _resolve(a), eb = _resolve(b);
        if (!ea.length || !eb.length) { notify('space.angleBetween: object not found', 'warning'); return null; }
        var va = _axisOf(ea).normalize(), vb = _axisOf(eb).normalize();
        var d = Math.max(-1, Math.min(1, va.dot(vb)));
        return Math.acos(Math.abs(d)) * 180 / Math.PI;
    };

    // ── connection helpers ──

    /**
     * Scan all strand ends for 5'/3' pairs within `threshold` oxDNA units
     * (default 1.0 ≈ backbone bond length 0.85 nm ≈ 1 unit).
     * Returns [{aId, bId, dist}] sorted by distance. Pure query — ligates nothing.
     */
    space.findNicks = function(threshold) {
        threshold = (threshold == null) ? 1.0 : threshold;
        var open5 = [], open3 = [];
        try {
            systems.forEach(function(sys) {
                (sys.strands || []).forEach(function(st) {
                    if (st.end5 && !st.end5.n5) open5.push(st.end5);
                    if (st.end3 && !st.end3.n3) open3.push(st.end3);
                });
            });
        } catch (err) {
            notify('space.findNicks failed: ' + err.message, 'warning');
            return [];
        }
        var pairs = [];
        open3.forEach(function(e3) {
            var p3;
            try { p3 = e3.getPos(); } catch(_) { return; }
            open5.forEach(function(e5) {
                if (e3 === e5) return;
                var p5;
                try { p5 = e5.getPos(); } catch(_) { return; }
                var d = p3.distanceTo(p5);
                if (d <= threshold) pairs.push({ aId: e3.id, bId: e5.id, dist: _r1(d) });
            });
        });
        pairs.sort(function(p, q) { return p.dist - q.dist; });
        return pairs;
    };

    /**
     * Auto-connect nearby strand ends: greedy closest-pair ligation of 5'/3'
     * ends within `threshold` (default 1.5 for outline vertices, where duplex
     * ends sit slightly back from the geometric corner).
     * opts: {circularize?: bool} — allow ligating a strand to itself (default false).
     * Returns {ligated: n, pairs: [{aId,bId,dist}]}.
     */
    space.ligateNearby = function(threshold, opts) {
        threshold = (threshold == null) ? 1.5 : threshold;
        opts = opts || {};
        var pairs = space.findNicks(threshold);
        var used = {}, ligated = [], done = [];
        pairs.forEach(function(p) {
            if (used[p.aId] || used[p.bId]) return;
            var a, b;
            try {
                a = api.getElements([p.aId])[0];
                b = api.getElements([p.bId])[0];
            } catch(_) { return; }
            if (!a || !b) return;
            if (!opts.circularize && a.strand === b.strand) return;
            try {
                edit.ligate(a, b);
                used[p.aId] = used[p.bId] = true;
                ligated.push(p);
            } catch(_) { /* incompatible pair — skip */ }
        });
        done = ligated;
        try { render(); } catch(_) {}
        notify('space.ligateNearby: ligated ' + done.length + ' connection(s) within ' + threshold + 'u', done.length ? 'success' : 'info');
        return { ligated: done.length, pairs: done };
    };

    /** Alias with an explicit name for prompts. */
    space.ligateAll = function(threshold) { return space.ligateNearby(threshold); };

    // ── scene summary / export ──

    /** {objects, totalNucleotides, totalStrands} quick counts. */
    space.countAll = function() {
        var d = space.digest();
        var nt = 0;
        d.objects.forEach(function(o) { if (o.kind !== 'group') nt += o.count; });
        var strands = 0;
        try {
            systems.forEach(function(sys) { strands += (sys.strands || []).length; });
        } catch(_) {}
        return { objects: d.objects.length, totalNucleotides: nt, totalStrands: strands };
    };

    /** JSON string of the digest (for copy-paste / prompt context). */
    space.exportScene = function() {
        var s = JSON.stringify(space.digest(), null, 2);
        notify('Scene digest copied to console (' + s.length + ' chars)', 'info');
        console.log('[space.exportScene]\n' + s);
        return s;
    };

    // ── snapshots ──

    /**
     * PNG dataURL of the current viewport, or null when the canvas is not
     * readable (e.g. preserveDrawingBuffer off). scale>1 renders larger via
     * a temporary canvas.
     */
    space.snapshotImage = function(scale) {
        try {
            var src = (typeof renderer !== 'undefined' && renderer.domElement)
                ? renderer.domElement
                : document.querySelector('#view canvas, canvas');
            if (!src || !src.toDataURL) return null;
            var url = src.toDataURL('image/png');
            if (!scale || scale === 1 || !url) return url;
            var img = new Image();
            var tmp = document.createElement('canvas');
            tmp.width = src.width * scale; tmp.height = src.height * scale;
            // NOTE: async draw — return the unscaled URL; scaled path best-effort.
            img.onload = function() {
                try {
                    tmp.getContext('2d').drawImage(img, 0, 0, tmp.width, tmp.height);
                    console.log('[space.snapshotImage] scaled x' + scale + ' ready in console (click to open):', tmp.toDataURL('image/png').slice(0, 80) + '…');
                } catch(_) {}
            };
            img.src = url;
            return url;
        } catch (err) {
            notify('space.snapshotImage failed: ' + err.message, 'warning');
            return null;
        }
    };

    /**
     * Snapshot + display it in the LLM chat panel. With a name, focuses the
     * object first so the snapshot shows the region of interest.
     */
    space.show = function(name) {
        if (name) {
            try { space.focus(name); } catch(_) {}
        }
        var url = space.snapshotImage();
        if (!url) { notify('space.show: snapshot unavailable', 'warning'); return null; }
        try {
            var log = document.getElementById('llm-chat-log') || document.getElementById('agent-chat-log');
            if (log) {
                var img = document.createElement('img');
                img.src = url;
                img.style.maxWidth = '100%';
                img.style.border = '1px solid #888';
                log.appendChild(img);
                log.scrollTop = log.scrollHeight;
            } else {
                window.open(url, '_blank');
            }
        } catch(_) { window.open(url, '_blank'); }
        return url;
    };

    return space;

})();

// Default the reference grid to visible (the View-menu "Grid" switch is
// checked by default): once the page has loaded and the scene exists, apply
// whatever that switch says -- checked means show. Deferred to window load
// (not script-eval time) so `scene`/`render` are ready; _buildGrid falls
// back to a default extent when the scene is still empty.
try {
    window.addEventListener('load', function() {
        try {
            var cb = document.getElementById('gridToggle');
            window.space.grid(cb ? cb.checked : true);
        } catch (_) {}
    });
} catch (_) {}

// ── Structure Ledger window backing (globals for windows/structureLedgerWindow.html) ──

/** oncreate for view.toggleWindow('structureLedgerWindow', ledgerSetup). */
function ledgerSetup() { ledgerRefresh(); }

/** Rebuild the ledger table from llmTracker.listDetailed(). */
function ledgerRefresh() {
    var box = document.getElementById('ledgerList');
    if (!box) return;
    box.innerHTML = '';
    var rows = [];
    try { rows = llmTracker.listDetailed(); } catch (err) {
        box.textContent = 'Ledger unavailable: ' + err.message;
        return;
    }
    if (!rows.length) {
        box.innerHTML = '<i>No named structures yet — build something with shapes.* or tag a selection with llmTracker.</i>';
        return;
    }
    var table = document.createElement('table');
    table.style.width = '100%';
    table.style.fontSize = '12px';
    var head = document.createElement('tr');
    ['Name', 'Kind', 'nt', 'Position (centroid)', 'Size', 'Direction (PCA)', ''].forEach(function(h) {
        var th = document.createElement('th');
        th.textContent = h;
        th.style.textAlign = 'left';
        head.appendChild(th);
    });
    table.appendChild(head);
    rows.forEach(function(r) {
        var tr = document.createElement('tr');
        function cell(txt) {
            var td = document.createElement('td');
            td.textContent = txt;
            td.style.padding = '2px 4px';
            return td;
        }
        if (r.color) { tr.style.borderLeft = '4px solid ' + r.color; }
        tr.appendChild(cell(r.name));
        tr.appendChild(cell(r.kind + (r.members ? ' (' + r.members.length + ')' : '')));
        tr.appendChild(cell(String(r.count)));
        tr.appendChild(cell(r.centroid ? '(' + r.centroid.join(', ') + ')' : '—'));
        tr.appendChild(cell(r.size ? '(' + r.size.join(', ') + ')' : '—'));
        tr.appendChild(cell(r.direction ? '(' + r.direction.join(', ') + ')' : '—'));
        var td = document.createElement('td');
        var bSel = document.createElement('button');
        bSel.textContent = 'Select';
        bSel.className = 'button small outline primary';
        bSel.onclick = (function(n) { return function() { ledgerSelect(n); }; })(r.name);
        var bFoc = document.createElement('button');
        bFoc.textContent = 'Inspect';
        bFoc.className = 'button small outline';
        bFoc.style.marginLeft = '4px';
        bFoc.onclick = (function(n) { return function() { ledgerFocus(n); }; })(r.name);
        td.appendChild(bSel);
        td.appendChild(bFoc);
        tr.appendChild(td);
        table.appendChild(tr);
    });
    box.appendChild(table);
}

/** Ledger row action: select the region. */
function ledgerSelect(name) {
    try { space.select(name); }
    catch (err) { notify('ledgerSelect failed: ' + err.message, 'warning'); }
}

/** Ledger row action: select + fly the camera to the region for inspection. */
function ledgerFocus(name) {
    try { space.focus(name); }
    catch (err) { notify('ledgerFocus failed: ' + err.message, 'warning'); }
}
