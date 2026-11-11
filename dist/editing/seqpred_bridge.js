/**
 * seqpred_bridge.ts
 *
 * Page-side wrapper around the seqpred WebAssembly module (wasm/seqpred/, built from rigidDNA2 branch seqpred-cpp: src/seqpred + ViennaRNA 2.7.2 compiled with Emscripten):
 * an RNA sequence goes in, the predicted secondary structure comes out (nested Turner 2004 MFE with the salt correction of ViennaRNA 2.7, plus the kissing / pseudoknot
 * layer of predictor v2). Like the rigidRNA bridge the computation is one long synchronous call, so it runs inside a Web Worker (wasm/seqpred/seqpred_worker.js); cancelling
 * terminates the worker. The build id (wasm/seqpred/build.json, the hash of the two .wasm files, written by tools/rd2wasm-e2e/stamp_seqpred_build.mjs) goes into every URL and into
 * the result, so the summary can say which build produced a structure.
 */
class SeqpredEngine {
    static baseUrl = 'wasm/seqpred/';
    /** Every model id that is checked against version.models of the loaded build before a run (single-chain ranking / price models). */
    static MODELS = ['v2', 'v3', 'v4', 'm2', 'h2d', 'ml2', 'ml3', 'nat1', 'e1', 'ml4'];
    worker = null;
    variant = null;
    readyVersion = null; // seqpred_version of the loaded module (set by start())
    loadSeconds = 0; // module loading time of the current worker: creating it to 'ready'
    nextId = 1;
    reject = null;
    static buildPromise = null;
    /** True when the loaded module build carries the model id (version.models block or probe). A model missing from the object is not in this build. */
    static modelSupported(v, id) {
        if (!v)
            return false;
        const mm = v.models;
        if (Array.isArray(mm) && mm.indexOf(id) >= 0)
            return true;
        if (mm && typeof mm === 'object' && !Array.isArray(mm) && Object.prototype.hasOwnProperty.call(mm, id)) {
            const e = mm[id];
            if (e && typeof e === 'object' && e.available === false)
                return false; // listed but not in this build
            return true;
        }
        if (id === 'm2')
            return /m2/i.test([v.predictor, v.seqpred].filter(Boolean).join(' '));
        return false;
    }
    /** True when the loaded module build carries the M2 re-ranker (version block or probe). */
    static m2Supported(v) { return SeqpredEngine.modelSupported(v, 'm2'); }
    /** wasm/seqpred/build.json (never cached); null when the module is not deployed. */
    static buildInfo() {
        if (!SeqpredEngine.buildPromise) {
            SeqpredEngine.buildPromise = fetch(new URL(SeqpredEngine.baseUrl + 'build.json', document.baseURI).href, { cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        }
        return SeqpredEngine.buildPromise;
    }
    async start(variant) {
        const info = await SeqpredEngine.buildInfo();
        const base = new URL(SeqpredEngine.baseUrl, document.baseURI).href;
        const q = info && info.build ? '?v=' + encodeURIComponent(info.build) : '';
        this.worker = new Worker(base + 'seqpred_worker.js' + q);
        this.variant = variant;
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this.loadSeconds = 0;
        return new Promise((resolve, reject) => {
            this.reject = reject;
            this.worker.onmessage = (ev) => {
                if (ev.data.type === 'ready') {
                    this.variant = ev.data.variant;
                    this.readyVersion = ev.data.version || null;
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    this.loadSeconds = (now - t0) / 1000;
                    resolve();
                }
                else if (ev.data.type === 'error')
                    reject(new Error(ev.data.message));
            };
            this.worker.onerror = (ev) => reject(new Error(ev.message || 'worker failed to load'));
            this.worker.postMessage({ type: 'init', base, variant, build: info ? info.build : '' });
        });
    }
    /** Terminates the worker: a running computation stops at once, the next run starts a fresh worker. */
    cancel() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.bld2Worker = null;
        }
        if (this.reject) {
            this.reject(new Error('cancelled'));
            this.reject = null;
        }
    }
    bld2Worker = null; // the worker that holds the bld2 motif library (a new worker starts without it)
    static bld2Bytes = null;
    /** The motif library of the bld2 3D builder (wasm/seqpred/bld2_lib.bin, about 7 MB, derived from public PDB entries): fetched on first use and kept in the Cache API (keyed by its version) so that it is downloaded once. */
    static async fetchBld2Library(onStatus) {
        if (!SeqpredEngine.bld2Bytes) {
            SeqpredEngine.bld2Bytes = (async () => {
                const info = await SeqpredEngine.buildInfo();
                const ver = info && info.bld2lib ? String(info.bld2lib) : (info && info.build ? String(info.build) : '0');
                const url = new URL(SeqpredEngine.baseUrl + 'bld2_lib.bin?v=' + encodeURIComponent(ver), document.baseURI).href;
                let cache = null;
                try {
                    if (typeof caches !== 'undefined')
                        cache = await caches.open('oxview-bld2-lib');
                }
                catch (e) {
                    cache = null;
                }
                try {
                    const hit = cache && await cache.match(url);
                    if (hit) {
                        if (onStatus)
                            onStatus('3D builder library: from the browser cache');
                        return new Uint8Array(await hit.arrayBuffer());
                    }
                }
                catch (e) { /* fetch below */ }
                if (onStatus)
                    onStatus('Loading the 3D builder library (about 7 MB, once)...');
                const r = await fetch(url);
                if (!r.ok)
                    throw new Error('The bld2 library (wasm/seqpred/bld2_lib.bin) is not deployed with this build (HTTP ' + r.status + ').');
                const buf = await r.arrayBuffer();
                try {
                    if (cache)
                        await cache.put(url, new Response(buf.slice(0)));
                }
                catch (e) { /* not cached: fetched again next time */ }
                return new Uint8Array(buf);
            })();
            SeqpredEngine.bld2Bytes.catch(() => { SeqpredEngine.bld2Bytes = null; });
        }
        return SeqpredEngine.bld2Bytes;
    }
    /** True when the loaded module carries the bld2 builder (version.models.bld2). */
    async bld2Supported() {
        const v = await this.versionInfo();
        return SeqpredEngine.modelSupported(v, 'bld2');
    }
    /** Builds a 3D model with bld2 from a sequence and a structure (dot-bracket string or 1-based pair list): loads the library into the worker on first use. Result: PDB text, oxRNA top / dat, the instance chosen for every loop. */
    async buildBld2(sequence, structure, onStatus) {
        if (!this.worker)
            await this.start('st');
        if (!(await this.bld2Supported()))
            throw new Error('This seqpred build does not carry the bld2 3D builder.');
        const worker = this.worker;
        const call = (msg, want, transfer) => new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.reject = reject;
            const prev = worker.onmessage;
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.id !== id) {
                    if (prev)
                        prev.call(worker, ev);
                    return;
                }
                worker.onmessage = prev;
                this.reject = null;
                if (m.type === want)
                    resolve(m);
                else
                    reject(new Error(m.message || 'bld2 failed'));
            };
            worker.postMessage(Object.assign({ id }, msg), transfer || []);
        });
        if (this.bld2Worker !== worker) {
            const bytes = await SeqpredEngine.fetchBld2Library(onStatus);
            if (onStatus)
                onStatus('Initialising the 3D builder...');
            const copy = bytes.slice();
            await call({ type: 'bld2lib', bytes: copy.buffer }, 'bld2loaded', [copy.buffer]);
            this.bld2Worker = worker;
        }
        if (onStatus)
            onStatus('Building the 3D model with bld2...');
        const m = await call({ type: 'bld2', sequence, structure, options: { oxrna: true } }, 'bld2built');
        return Object.assign({}, m.result, { wallSeconds: m.wallSeconds });
    }
    /** The version block of the loaded module (starts the worker when needed). */
    async versionInfo() {
        if (!this.worker)
            await this.start('st');
        return this.readyVersion;
    }
    /** Scores a pair set against a reference structure with the C++ metrics of the module (precision / recall / F1 / MCC, crossing recall, helix recall, pk_found, false helices).
     *  request = { reference: { format: 'dotbracket' | 'pairs' | 'bpseq' | 'ct', text }, prediction: { pairs: [i, j][] (1-based) } | { dotbracket }, n?, options? } */
    async score(request) {
        if (!this.worker)
            await this.start('st');
        const worker = this.worker, id = this.nextId++;
        return new Promise((resolve, reject) => {
            const prev = worker.onmessage;
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.id !== id) {
                    if (prev)
                        prev.call(worker, ev);
                    return;
                }
                worker.onmessage = prev;
                if (m.type === 'scored')
                    resolve(m.result);
                else
                    reject(new Error(m.message || 'score failed'));
            };
            worker.postMessage({ type: 'score', id, request });
        });
    }
    /** Base pairs of an oxDNA / oxRNA configuration with the C++ reader of the module (port of runall.refs.oxdna_pairs, geometric criterion), the reference of a model of this project or of any
     *  oxDNA-format file. request = { top: text, dat: text, molecule?: 'RNA' | 'DNA', minStack?: number }; result: pairs (1-based, 5'->3'), sequence, strands, n, nGeo, compGeo, notes. */
    async oxPairs(request) {
        if (!this.worker)
            await this.start('st');
        const worker = this.worker, id = this.nextId++;
        return new Promise((resolve, reject) => {
            const prev = worker.onmessage;
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.id !== id) {
                    if (prev)
                        prev.call(worker, ev);
                    return;
                }
                worker.onmessage = prev;
                if (m.type === 'oxpaired')
                    resolve(m.result);
                else
                    reject(new Error(m.message || 'oxpairs failed'));
            };
            worker.postMessage({ type: 'oxpairs', id, request });
        });
    }
    /** Predicts the structure of one sequence; rejects with Error('cancelled') after cancel(). */
    async predict(sequence, opts) {
        const wantMt = (opts.threads || 1) > 1 && RnaEngine.capabilities().isolated;
        const variant = wantMt ? 'mt' : 'st';
        if (this.worker && this.variant !== variant)
            this.cancel();
        const warm = !!this.worker;
        if (!this.worker)
            await this.start(variant);
        // Backwards compatibility: the single-chain predictor used to be chosen by method alone
        // (method v2/v3); the model field is new. Old callers without options.model still get v2.
        // Any single-chain model missing from the loaded build is refused here (the tab disables it too).
        const o = Object.assign({}, opts);
        if (!o.method && !o.model)
            o.method = 'v2';
        else if (o.model && (!o.method || SeqpredEngine.MODELS.indexOf(o.method) >= 0)) {
            if (!SeqpredEngine.modelSupported(this.readyVersion, o.model))
                throw new Error('The ' + o.model.toUpperCase() + ' model is not in this seqpred build (' + (this.readyVersion && this.readyVersion.predictor ? this.readyVersion.predictor : 'no version') + '): v2 remains the validated predictor.');
            o.method = o.model;
        }
        if (o.method && SeqpredEngine.MODELS.indexOf(o.method) >= 0 && !SeqpredEngine.modelSupported(this.readyVersion, o.method))
            throw new Error('The ' + String(o.method).toUpperCase() + ' model is not in this seqpred build: v2 remains the validated predictor.');
        const info = await SeqpredEngine.buildInfo();
        const loadSeconds = warm ? 0 : this.loadSeconds;
        const worker = this.worker, id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.reject = reject;
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.id !== id)
                    return;
                if (m.type === 'result') {
                    this.reject = null;
                    resolve(Object.assign({}, m.result, { build: info, variant: this.variant, wallSeconds: m.wallSeconds, loadSeconds }));
                }
                else if (m.type === 'error') {
                    this.reject = null;
                    this.cancel();
                    reject(new Error(m.message));
                }
            };
            worker.onerror = (ev) => { this.reject = null; this.cancel(); reject(new Error(ev.message || 'worker error')); };
            worker.postMessage({ type: 'predict', id, sequence, options: o });
        });
    }
}
