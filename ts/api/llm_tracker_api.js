/**
 * llm_tracker_api.js — Tracking system for LLM-created nucleotide groups
 *
 * Wraps the built-in `clusterId` / `clusterCounter` system with a persistent
 * name registry so the LLM can refer to previously created objects by name
 * across separate code blocks.
 *
 * Each entry carries live spatial metadata (centroid, bounding box,
 * principal direction, colour) so the Structure Ledger window and the
 * `space.*` API can present every structure with a name, a direction and a
 * position — and the user can click an entry to select / inspect it.
 *
 * Must be loaded AFTER dist/api/editing_api.js (for edit.deleteElements).
 *
 * New global exposed: `llmTracker`
 *
 * Quick reference:
 *   llmTracker.tag(elems, name?, color?, kind?) → clusterId: number
 *   llmTracker.alias(name, members: string[])   → void  (named group of groups)
 *   llmTracker.resolve(name)                    → BasicElement[] (registry or alias)
 *   llmTracker.getByName(name)                  → BasicElement[] (alias-aware)
 *   llmTracker.getByClusterId(id)               → BasicElement[]
 *   llmTracker.getAll()                         → BasicElement[]
 *   llmTracker.list()                           → [{name, clusterId, size, kind}]
 *   llmTracker.listDetailed()                   → [{name, kind, count, centroid,
 *                                                  bbox, size, direction, color,
 *                                                  createdBy, createdAt, members?}]
 *   llmTracker.info(name)                       → detailed record | null
 *   llmTracker.describe()                       → human-readable multi-line string
 *   llmTracker.selectByName(name, keepPrev?)    → void
 *   llmTracker.focus(name)                      → void  (fly camera to object)
 *   llmTracker.colorByName(name, color)         → void
 *   llmTracker.rename(oldName, newName)         → void
 *   llmTracker.deleteByName(name)               → void
 *   llmTracker.clear()                          → void
 *   llmTracker.status()                         → void  (logs + notify)
 *   llmTracker.lastTag                          → string | null
 *   llmTracker.lastClusterId                    → number
 */

window.llmTracker = (function() {

    // name → { clusterId, size, kind, color, createdBy, createdAt }
    //   kind: 'shape' | 'edge' | 'duplex' | 'selection' | 'import' | ...
    //   color: css string recorded at tag time (may drift afterwards)
    //   createdBy: free-form provenance label, e.g. 'shapes.star', 'space.duplicate'
    var _registry = {};

    // alias name → [member names] (members may themselves be aliases; cycles guarded)
    var _aliases = {};

    var _lastTag = null;

    // ── private helpers ────────────────────────────────────────────────────────

    function _getAllElems() {
        var all = [];
        try {
            systems.forEach(function(sys) {
                try { sys.getMonomers().forEach(function(e) { all.push(e); }); } catch(_) {}
            });
        } catch(_) {}
        try {
            tmpSystems.forEach(function(sys) {
                try { sys.getMonomers().forEach(function(e) { all.push(e); }); } catch(_) {}
            });
        } catch(_) {}
        return all;
    }

    function _byCluster(cid) {
        return _getAllElems().filter(function(e) { return e.clusterId === cid; });
    }

    function _v3(x, y, z) {
        return new THREE.Vector3(x, y, z);
    }

    function _round1(v) { return Math.round(v * 10) / 10; }

    /** Live spatial stats for an element set. All fields plain JSON-safe values. */
    function _stats(elems) {
        if (!elems || elems.length === 0) return null;
        var min = _v3(Infinity, Infinity, Infinity);
        var max = _v3(-Infinity, -Infinity, -Infinity);
        var com = _v3(0, 0, 0);
        var n = 0;
        elems.forEach(function(e) {
            var p;
            try { p = e.getPos(); } catch(_) { return; }
            if (!p) return;
            n++;
            com.x += p.x; com.y += p.y; com.z += p.z;
            if (p.x < min.x) min.x = p.x; if (p.y < min.y) min.y = p.y; if (p.z < min.z) min.z = p.z;
            if (p.x > max.x) max.x = p.x; if (p.y > max.y) max.y = p.y; if (p.z > max.z) max.z = p.z;
        });
        if (n === 0) return null;
        com.divideScalar(n);
        var direction = null;
        try {
            if (typeof api !== 'undefined' && api.getPCA && elems.length >= 3) {
                var pca = api.getPCA(elems);
                if (pca && pca.primaryAxis) {
                    direction = [_round1(pca.primaryAxis.x), _round1(pca.primaryAxis.y), _round1(pca.primaryAxis.z)];
                }
            }
        } catch(_) {}
        if (!direction) {
            // Fallback: longest bounding-box axis.
            var sx = max.x - min.x, sy = max.y - min.y, sz = max.z - min.z;
            direction = (sx >= sy && sx >= sz) ? [1, 0, 0] : (sy >= sz ? [0, 1, 0] : [0, 0, 1]);
        }
        var color = null;
        for (var i = 0; i < elems.length; i++) {
            try {
                var c = elems[i].color;
                if (c && typeof c.getHexString === 'function') { color = '#' + c.getHexString(); break; }
            } catch(_) {}
        }
        return {
            count: n,
            centroid: [_round1(com.x), _round1(com.y), _round1(com.z)],
            bbox: {
                min: [_round1(min.x), _round1(min.y), _round1(min.z)],
                max: [_round1(max.x), _round1(max.y), _round1(max.z)]
            },
            size: [_round1(max.x - min.x), _round1(max.y - min.y), _round1(max.z - min.z)],
            direction: direction,
            color: color
        };
    }

    /** Resolve a name to elements, following aliases (cycle-safe). */
    function _resolve(name, seen) {
        if (name == null) return [];
        if (typeof name === 'number') return _byCluster(name);
        if (!_registry[name] && !_aliases[name]) return [];
        seen = seen || {};
        if (seen[name]) return [];
        seen[name] = true;
        if (_registry[name]) return _byCluster(_registry[name].clusterId);
        var out = [], seenIds = {};
        _aliases[name].forEach(function(m) {
            _resolve(m, seen).forEach(function(e) {
                if (!seenIds[e.id]) { seenIds[e.id] = true; out.push(e); }
            });
        });
        return out;
    }

    function _cssColor(color) {
        if (!color) return null;
        try {
            if (typeof color === 'string') return color;
            if (color instanceof THREE.Color) return '#' + color.getHexString();
            if (color.isColor) return '#' + color.getHexString();
        } catch(_) {}
        return String(color);
    }

    // ── public API ────────────────────────────────────────────────────────────

    return {

        /**
         * Tag a set of elements: assign a new cluster ID and store in the registry.
         *
         * @param {BasicElement[]} elems  Elements to tag.
         * @param {string}  [name]        Human-readable label. Auto-generated if omitted.
         * @param {THREE.Color|string} [color]  Optional colour to apply immediately.
         * @param {string}  [kind]        Provenance kind: 'shape' (default), 'edge',
         *                                'duplex', 'selection', 'import', 'copy', ...
         * @returns {number} The cluster ID assigned.
         *
         * Example:
         *   var elems = edit.createStrand('ATCG', true);
         *   llmTracker.tag(elems.filter(Boolean), 'myDuplex', new THREE.Color(0,1,0), 'duplex');
         */
        tag: function(elems, name, color, kind) {
            if (!elems || elems.length === 0) {
                notify('llmTracker.tag: no elements', 'warning');
                return null;
            }
            clusterCounter++;
            var cid = clusterCounter;
            name = name || ('llm_' + cid);
            elems.forEach(function(e) { e.clusterId = cid; });
            _registry[name] = {
                clusterId: cid,
                size: elems.length,
                kind: kind || 'shape',
                color: _cssColor(color),
                createdBy: kind || 'shape',
                createdAt: new Date().toISOString()
            };
            delete _aliases[name];
            _lastTag = name;

            if (color) {
                var c = (color instanceof THREE.Color) ? color : new THREE.Color(color);
                colorElements(c, elems);
            }
            return cid;
        },

        /**
         * Register a named group of existing registry/alias names (no re-clustering).
         * Members keep their own cluster IDs; the alias resolves to the union.
         * Used e.g. by shapes.triangleCrystal: per-edge tags + per-cell aliases +
         * one crystal-level alias.
         *
         * @param {string}   name
         * @param {string[]} members  Registry or alias names.
         *
         * Example:
         *   llmTracker.alias('crystal1', ['crystal1_e0', 'crystal1_e1']);
         */
        alias: function(name, members) {
            if (!name || !members || members.length === 0) {
                notify('llmTracker.alias: need a name and at least one member', 'warning');
                return;
            }
            delete _registry[name];
            _aliases[name] = members.slice();
            _lastTag = name;
        },

        /**
         * Resolve any name (registry entry, alias, or numeric cluster ID) to elements.
         * @param {string|number} name
         * @returns {BasicElement[]}
         */
        resolve: function(name) { return _resolve(name, {}); },

        /**
         * Get all elements currently bearing the given tag name.
         * Alias-aware; re-queries live element state — safe to call after edits.
         *
         * @param {string} name
         * @returns {BasicElement[]}
         */
        getByName: function(name) {
            return _resolve(name, {});
        },

        /**
         * Get all elements with a specific cluster ID.
         *
         * @param {number} cid
         * @returns {BasicElement[]}
         */
        getByClusterId: function(cid) {
            return _byCluster(cid);
        },

        /**
         * Get every element that has any LLM tracker tag.
         *
         * @returns {BasicElement[]}
         */
        getAll: function() {
            var knownCids = {};
            Object.keys(_registry).forEach(function(n) {
                knownCids[_registry[n].clusterId] = true;
            });
            return _getAllElems().filter(function(e) { return knownCids[e.clusterId]; });
        },

        /**
         * List all registered tags (registry entries only, no aliases).
         *
         * @returns {{name: string, clusterId: number, size: number, kind: string}[]}
         */
        list: function() {
            return Object.keys(_registry).map(function(name) {
                return {
                    name:      name,
                    clusterId: _registry[name].clusterId,
                    size:      _registry[name].size,
                    kind:      _registry[name].kind
                };
            });
        },

        /**
         * List every registered name (registry entries AND aliases) with live
         * spatial metadata: centroid, bbox, size, principal direction, colour.
         * This is what the Structure Ledger window displays.
         *
         * @returns {Object[]}
         */
        listDetailed: function() {
            var self = this;
            var out = [];
            Object.keys(_registry).forEach(function(name) {
                var elems = _resolve(name, {});
                var st = _stats(elems);
                out.push({
                    name: name,
                    kind: _registry[name].kind,
                    clusterId: _registry[name].clusterId,
                    createdBy: _registry[name].createdBy,
                    createdAt: _registry[name].createdAt,
                    members: null,
                    count: st ? st.count : 0,
                    centroid: st ? st.centroid : null,
                    bbox: st ? st.bbox : null,
                    size: st ? st.size : null,
                    direction: st ? st.direction : null,
                    color: (st && st.color) || _registry[name].color
                });
            });
            Object.keys(_aliases).forEach(function(name) {
                var elems = _resolve(name, {});
                var st = _stats(elems);
                out.push({
                    name: name,
                    kind: 'group',
                    clusterId: null,
                    createdBy: 'alias',
                    createdAt: null,
                    members: _aliases[name].slice(),
                    count: st ? st.count : 0,
                    centroid: st ? st.centroid : null,
                    bbox: st ? st.bbox : null,
                    size: st ? st.size : null,
                    direction: st ? st.direction : null,
                    color: st ? st.color : null
                });
            });
            return out;
        },

        /**
         * Full live record for one name (registry entry or alias), or null.
         * @param {string} name
         * @returns {Object|null}
         */
        info: function(name) {
            var found = this.listDetailed().filter(function(r) { return r.name === name; });
            return found.length ? found[0] : null;
        },

        /**
         * Human-readable multi-line summary of every registered object:
         * name, kind, nucleotide count, centroid, size, principal direction.
         * @returns {string}
         */
        describe: function() {
            var rows = this.listDetailed();
            if (rows.length === 0) return 'Structure registry: (empty — no named objects yet)';
            return 'Structure registry:\n' + rows.map(function(r) {
                var pos = r.centroid ? ('pos=(' + r.centroid.join(',') + ')') : 'pos=(?)';
                var sz = r.size ? ('size=(' + r.size.join(',') + ')') : '';
                var dir = r.direction ? ('dir=(' + r.direction.join(',') + ')') : '';
                var extra = r.kind === 'group' ? (' members=' + (r.members || []).length) : (' cluster=' + r.clusterId);
                return '  - "' + r.name + '" [' + r.kind + extra + '] n=' + r.count + ' ' + pos + ' ' + sz + ' ' + dir;
            }).join('\n');
        },

        /**
         * Delete all elements bearing the given tag name. For an alias name,
         * only the alias is removed (members are kept).
         *
         * @param {string} name
         */
        deleteByName: function(name) {
            if (_aliases[name]) {
                delete _aliases[name];
                if (_lastTag === name) _lastTag = null;
                render();
                return;
            }
            var elems = this.getByName(name);
            if (elems.length > 0) edit.deleteElements(elems);
            delete _registry[name];
            if (_lastTag === name) _lastTag = null;
            render();
        },

        /**
         * Delete ALL tracked elements and clear the registry and aliases.
         */
        clear: function() {
            var self = this;
            var names = Object.keys(_registry);
            names.forEach(function(name) {
                var elems = self.getByName(name);
                if (elems.length > 0) edit.deleteElements(elems);
            });
            _registry = {};
            _aliases = {};
            _lastTag = null;
            render();
        },

        /**
         * Print a summary of all tags to the notification area and browser console.
         */
        status: function() {
            var list = this.list();
            var nAlias = Object.keys(_aliases).length;
            if (list.length === 0 && nAlias === 0) {
                notify('LLM Tracker: no tagged groups', 'info');
                return;
            }
            var msg = list.map(function(t) {
                return '"' + t.name + '" cluster=' + t.clusterId + ' (' + t.size + ' elems)';
            }).join(' | ');
            if (nAlias > 0) msg += ' | ' + nAlias + ' group alias(es): ' + Object.keys(_aliases).join(', ');
            notify('LLM Tracker: ' + msg, 'info');
            console.log('[llmTracker] registry:', JSON.stringify(list, null, 2));
        },

        /**
         * Select all elements in a named group (registry entry or alias).
         *
         * @param {string} name
         * @param {boolean} [keepPrev]  Add to the current selection instead of replacing.
         */
        selectByName: function(name, keepPrev) {
            var elems = this.getByName(name);
            if (elems.length === 0) {
                notify('llmTracker: "' + name + '" not found', 'warning');
                return;
            }
            api.selectElements(elems, keepPrev);
        },

        /**
         * Fly the camera to a named object and select it, so the user can
         * inspect the region the LLM just built or modified.
         *
         * @param {string} name
         */
        focus: function(name) {
            var elems = this.getByName(name);
            if (elems.length === 0) {
                notify('llmTracker.focus: "' + name + '" not found', 'warning');
                return;
            }
            try {
                api.selectElements(elems);
                api.findElement(elems[0]);
                notify('Focused "' + name + '" (' + elems.length + ' nt)', 'info');
            } catch (err) {
                notify('llmTracker.focus failed: ' + err.message, 'warning');
            }
        },

        /**
         * Rename a registry entry or alias (member references are updated).
         *
         * @param {string} oldName
         * @param {string} newName
         */
        rename: function(oldName, newName) {
            if (!newName || _registry[newName] || _aliases[newName]) {
                notify('llmTracker.rename: bad or duplicate new name', 'warning');
                return;
            }
            if (_registry[oldName]) {
                _registry[newName] = _registry[oldName];
                delete _registry[oldName];
            } else if (_aliases[oldName]) {
                _aliases[newName] = _aliases[oldName];
                delete _aliases[oldName];
            } else {
                notify('llmTracker.rename: "' + oldName + '" not found', 'warning');
                return;
            }
            Object.keys(_aliases).forEach(function(a) {
                _aliases[a] = _aliases[a].map(function(m) { return m === oldName ? newName : m; });
            });
            if (_lastTag === oldName) _lastTag = newName;
            render();
        },

        /**
         * Colour all elements of a tag with a new colour.
         *
         * @param {string} name
         * @param {THREE.Color|string} color
         */
        colorByName: function(name, color) {
            var elems = this.getByName(name);
            if (elems.length === 0) return;
            var c = (color instanceof THREE.Color) ? color : new THREE.Color(color);
            colorElements(c, elems);
        },

        /**
         * Most recently assigned tag name (useful in the LLM's next code block).
         * @type {string|null}
         */
        get lastTag() { return _lastTag; },

        /**
         * The current global cluster counter (= ID of last cluster created by any means).
         * @type {number}
         */
        get lastClusterId() { return clusterCounter; }
    };

})();
