/**
 * rigidrna_bridge.ts
 *
 * Page-side wrapper around the rigidRNA WebAssembly engine (wasm/rigidrna/, built from rigidRNA/wasm: apps/rd2_rna.cpp compiled with Emscripten).
 * Like the rigidDNA2 bridge (rigiddna2_bridge.ts) the whole computation is one long synchronous call, so it runs inside a Web Worker
 * (wasm/rigidrna/rd2rna_worker.js) and the page only receives log lines; cancelling terminates the worker (a new one starts on the next run).
 * Input: an RNA sequence with its (pseudoknotted) dot-bracket structure. Output: the oxRNA2 .top/.dat of the rigid base-pair-node model after a de novo layout
 * of the stems and Levenberg-Marquardt relaxation, optionally with the salt-dependent Debye-Hueckel term of oxRNA2 between the backbone charges of the stems.
 *
 * Two builds of the module exist: `mt` (pthreads + OpenMP, needs SharedArrayBuffer, i.e. a cross-origin-isolated page) and `st` (single thread).
 */
class RnaEngine {
    static baseUrl = 'wasm/rigidrna/';
    worker = null;
    variant = null;
    maxThreads = 1;
    nextId = 1;
    reject = null;
    static capabilities() {
        return {
            isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined',
            cores: navigator.hardwareConcurrency || 1,
        };
    }
    /** Threads the threaded build will use at most (its worker pool is min(cores, 8)). */
    static maxUsableThreads() {
        const c = RnaEngine.capabilities();
        return c.isolated ? Math.min(c.cores, 8) : 1;
    }
    start(variant) {
        const base = new URL(RnaEngine.baseUrl, document.baseURI).href;
        this.worker = new Worker(base + 'rd2rna_worker.js');
        this.variant = variant;
        return new Promise((resolve, reject) => {
            this.reject = reject;
            this.worker.onmessage = (ev) => {
                if (ev.data.type === 'ready') {
                    this.maxThreads = ev.data.threads;
                    resolve();
                }
                else if (ev.data.type === 'error')
                    reject(new Error(ev.data.message));
            };
            this.worker.onerror = (ev) => reject(new Error(ev.message || 'worker failed to load'));
            this.worker.postMessage({ type: 'init', base, variant });
        });
    }
    /** Terminates the worker: a running computation stops at once, the next run starts a fresh worker. */
    cancel() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        if (this.reject) {
            this.reject(new Error('cancelled'));
            this.reject = null;
        }
    }
    /** Runs one structure (sequence + dot-bracket); resolves with the oxRNA .top/.dat text and the report; rejects with Error('cancelled') after cancel(). */
    async run(input, opts, onLog) {
        const wantThreads = Math.max(1, opts.threads || 1);
        const variant = wantThreads > 1 && RnaEngine.capabilities().isolated ? 'mt' : 'st';
        if (this.worker && this.variant !== variant)
            this.cancel();
        if (!this.worker)
            await this.start(variant);
        const worker = this.worker, id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.reject = reject;
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.id !== id)
                    return;
                if (m.type === 'log') {
                    if (onLog)
                        onLog(m.line);
                }
                else if (m.type === 'result') {
                    this.reject = null;
                    resolve({ rc: m.rc, top: m.top, dat: m.dat, report: m.report, flags: m.flags, log: m.log, seconds: m.seconds, threads: m.threads, variant });
                }
                else if (m.type === 'error') {
                    this.reject = null;
                    this.cancel();
                    reject(new Error(m.message));
                }
            };
            worker.onerror = (ev) => { this.reject = null; this.cancel(); reject(new Error(ev.message || 'worker error')); };
            worker.postMessage({ type: 'run', id, input, options: Object.assign({}, opts, { threads: Math.min(wantThreads, variant === 'mt' ? this.maxThreads : 1) }) });
        });
    }
}
