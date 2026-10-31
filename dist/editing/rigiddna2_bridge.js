/**
 * rigiddna2_bridge.ts
 *
 * Page-side wrapper around the rigidDNA2 WebAssembly engine (wasm/rigiddna2/, built from rigidDNA2/wasm of
 * https://github.com/Subhajit-Roy-Partho/rigidDNA, see docs/26_webassembly.md there). Unlike the older rigidDNA bridge (rigiddna_bridge.ts)
 * this one is not a direct call into the module: the whole computation (front end, coarse rigid-body relaxation, nucleotide export, native
 * oxDNA2 relaxation, safety gate) is one long synchronous call, so it runs inside a Web Worker (wasm/rigiddna2/rd2_worker.js) and the page only
 * receives progress events. Cancelling terminates the worker (a new one is started on the next run).
 *
 * Two builds of the module exist: `mt` (pthreads + OpenMP, needs SharedArrayBuffer, i.e. a cross-origin-isolated page: COOP/COEP headers, see
 * serve.json and coi-serviceworker.js) and `st` (single thread, works anywhere). Rd2Engine picks `mt` when the page is isolated and more than one
 * thread is requested.
 */
class Rd2Engine {
    static baseUrl = 'wasm/rigiddna2/';
    worker = null;
    variant = null;
    maxThreads = 1;
    nextId = 1;
    reject = null;
    static capabilities() {
        return {
            isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined',
            cores: navigator.hardwareConcurrency || 1,
            webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
        };
    }
    /** Threads the threaded build will use at most (its worker pool is min(cores, 8)). */
    static maxUsableThreads() {
        const c = Rd2Engine.capabilities();
        return c.isolated ? Math.min(c.cores, 8) : 1;
    }
    /**
     * Probes WebGPU: adapter, device and one tiny compute dispatch with read-back. This is what a WebGPU backend for the native FIRE relaxation would need;
     * the relaxation itself does not use it yet (docs/26_webassembly.md section 6).
     */
    static async probeGpu() {
        const none = (note) => ({ available: false, adapter: '', software: false, note });
        const gpu = navigator.gpu;
        if (!gpu)
            return none('navigator.gpu is not defined (no WebGPU in this browser or context)');
        try {
            const ad = await gpu.requestAdapter();
            if (!ad)
                return none('no WebGPU adapter');
            const info = ad.info || {};
            const dev = await ad.requestDevice();
            const buf = dev.createBuffer({ size: 16, usage: 0x80 /* STORAGE */ | 0x04 /* COPY_SRC */ });
            const out = dev.createBuffer({ size: 16, usage: 0x01 /* MAP_READ */ | 0x08 /* COPY_DST */ });
            const mod = dev.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> d: array<f32>; @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) g: vec3<u32>) { d[g.x] = f32(g.x) * 2.0 + 1.0; }' });
            const pipe = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
            const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
            const enc = dev.createCommandEncoder();
            const pass = enc.beginComputePass();
            pass.setPipeline(pipe);
            pass.setBindGroup(0, bg);
            pass.dispatchWorkgroups(1);
            pass.end();
            enc.copyBufferToBuffer(buf, 0, out, 0, 16);
            dev.queue.submit([enc.finish()]);
            await out.mapAsync(1 /* READ */);
            const r = Array.from(new Float32Array(out.getMappedRange()));
            const adapter = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
            const software = /swiftshader|llvmpipe|software|cpu/i.test(adapter) || !!ad.isFallbackAdapter;
            if (r.join() !== '1,3,5,7')
                return none('the compute shader returned a wrong result: ' + r.join());
            return { available: true, adapter, software, note: software ? 'adapter is a software rasteriser, not a GPU' : 'compute shader ran on the adapter' };
        }
        catch (e) {
            return none('WebGPU probe failed: ' + e);
        }
    }
    start(variant) {
        const base = new URL(Rd2Engine.baseUrl, document.baseURI).href;
        this.worker = new Worker(base + 'rd2_worker.js');
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
    /**
     * Runs one design. input.name decides the format (.json caDNAno, .sc scadnano, .top oxDNA with its configuration in input.dat).
     * Resolves with the oxDNA topology/configuration text and the summary; rejects with Error('cancelled') after cancel().
     */
    async run(input, opts, onProgress, onLog) {
        const wantThreads = Math.max(1, opts.threads || 1);
        const variant = wantThreads > 1 && Rd2Engine.capabilities().isolated ? 'mt' : 'st';
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
                if (m.type === 'progress') {
                    if (onProgress)
                        onProgress(m);
                }
                else if (m.type === 'log') {
                    if (onLog)
                        onLog(m.line);
                }
                else if (m.type === 'result') {
                    this.reject = null;
                    resolve({ rc: m.rc, top: m.top, dat: m.dat, summary: m.summary, log: m.log, seconds: m.seconds, threads: m.threads, variant,
                        gpu: { requested: opts.gpu === 'auto', used: false, reason: 'the relaxation has no WebGPU path: it ran on the CPU (WebAssembly)' } });
                }
                else if (m.type === 'error') {
                    this.reject = null;
                    this.cancel();
                    reject(new Error(m.message));
                }
            };
            worker.onerror = (ev) => { this.reject = null; this.cancel(); reject(new Error(ev.message || 'worker error')); };
            worker.postMessage({ type: 'run', id, name: input.name, text: input.text, dat: input.dat, options: Object.assign({}, opts, { threads: Math.min(wantThreads, variant === 'mt' ? this.maxThreads : 1) }) });
        });
    }
}
