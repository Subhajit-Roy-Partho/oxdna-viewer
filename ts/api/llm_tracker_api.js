/**
 * llm_tracker_api.js — Tracking system for LLM-created nucleotide groups
 *
 * Wraps the built-in `clusterId` / `clusterCounter` system with a persistent
 * name registry so the LLM can refer to previously created objects by name
 * across separate code blocks.
 *
 * Must be loaded AFTER dist/api/editing_api.js (for edit.deleteElements).
 *
 * New global exposed: `llmTracker`
 *
 * Quick reference:
 *   llmTracker.tag(elems, name?, color?)  → clusterId: number
 *   llmTracker.getByName(name)            → BasicElement[]
 *   llmTracker.getByClusterId(id)         → BasicElement[]
 *   llmTracker.getAll()                   → BasicElement[]
 *   llmTracker.list()                     → [{name, clusterId, size}]
 *   llmTracker.deleteByName(name)         → void
 *   llmTracker.clear()                    → void
 *   llmTracker.status()                   → void  (logs + notify)
 *   llmTracker.lastTag                    → string | null
 *   llmTracker.lastClusterId              → number
 */

window.llmTracker = (function() {

    // name → { clusterId: number, size: number, color: string|null }
    var _registry = {};
    var _lastTag = null;

    // ── private helpers ────────────────────────────────────────────────────────

    function _getAllElems() {
        var all = [];
        systems.forEach(function(sys) {
            try { sys.getMonomers().forEach(function(e) { all.push(e); }); } catch(_) {}
        });
        tmpSystems.forEach(function(sys) {
            try { sys.getMonomers().forEach(function(e) { all.push(e); }); } catch(_) {}
        });
        return all;
    }

    function _byCluster(cid) {
        return _getAllElems().filter(function(e) { return e.clusterId === cid; });
    }

    // ── public API ────────────────────────────────────────────────────────────

    return {

        /**
         * Tag a set of elements: assign a new cluster ID and store in the registry.
         *
         * @param {BasicElement[]} elems  Elements to tag.
         * @param {string}  [name]        Human-readable label. Auto-generated if omitted.
         * @param {THREE.Color|string} [color]  Optional colour to apply immediately.
         * @returns {number} The cluster ID assigned.
         *
         * Example:
         *   var elems = edit.createStrand('ATCG', true);
         *   llmTracker.tag(elems.filter(Boolean), 'myDuplex', new THREE.Color(0,1,0));
         */
        tag: function(elems, name, color) {
            if (!elems || elems.length === 0) {
                notify('llmTracker.tag: no elements', 'warning');
                return null;
            }
            clusterCounter++;
            var cid = clusterCounter;
            name = name || ('llm_' + cid);
            elems.forEach(function(e) { e.clusterId = cid; });
            _registry[name] = { clusterId: cid, size: elems.length };
            _lastTag = name;

            if (color) {
                var c = (color instanceof THREE.Color) ? color : new THREE.Color(color);
                colorElements(c, elems);
            }
            return cid;
        },

        /**
         * Get all elements currently bearing the given tag name.
         * Re-queries live element state — safe to call after edits.
         *
         * @param {string} name
         * @returns {BasicElement[]}
         */
        getByName: function(name) {
            if (!_registry[name]) return [];
            return _byCluster(_registry[name].clusterId);
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
            var knownCids = new Set(Object.keys(_registry).map(function(n) {
                return _registry[n].clusterId;
            }));
            return _getAllElems().filter(function(e) { return knownCids.has(e.clusterId); });
        },

        /**
         * List all registered tags.
         *
         * @returns {{name: string, clusterId: number, size: number}[]}
         */
        list: function() {
            return Object.keys(_registry).map(function(name) {
                return {
                    name:      name,
                    clusterId: _registry[name].clusterId,
                    size:      _registry[name].size
                };
            });
        },

        /**
         * Delete all elements bearing the given tag name.
         *
         * @param {string} name
         */
        deleteByName: function(name) {
            var elems = this.getByName(name);
            if (elems.length > 0) edit.deleteElements(elems);
            delete _registry[name];
            if (_lastTag === name) _lastTag = null;
            render();
        },

        /**
         * Delete ALL elements that have any LLM tracker tag, and clear the registry.
         */
        clear: function() {
            var self = this;
            var names = Object.keys(_registry);
            names.forEach(function(name) {
                var elems = self.getByName(name);
                if (elems.length > 0) edit.deleteElements(elems);
            });
            _registry = {};
            _lastTag = null;
            render();
        },

        /**
         * Print a summary of all tags to the notification area and browser console.
         */
        status: function() {
            var list = this.list();
            if (list.length === 0) {
                notify('LLM Tracker: no tagged groups', 'info');
                return;
            }
            var msg = list.map(function(t) {
                return '"' + t.name + '" cluster=' + t.clusterId + ' (' + t.size + ' elems)';
            }).join(' | ');
            notify('LLM Tracker: ' + msg, 'info');
            console.log('[llmTracker] registry:', JSON.stringify(list, null, 2));
        },

        /**
         * Select all elements in a named group.
         *
         * @param {string} name
         */
        selectByName: function(name) {
            var elems = this.getByName(name);
            if (elems.length === 0) {
                notify('llmTracker: "' + name + '" not found', 'warning');
                return;
            }
            api.selectElements(elems);
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
