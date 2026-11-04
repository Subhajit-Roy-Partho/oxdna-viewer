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

interface Rd2Options {
    route?: 'auto' | 'lattice' | 'wireframe' | 'articulated' | 'ring';
    inferStaples?: 'auto' | 'on' | 'off';
    linkers?: 'auto' | 'on' | 'off';   // poly-T gap linkers of the lattice route; auto: none for a scadnano design
    lattice?: 'auto' | 'square' | 'honeycomb';
    native?: boolean;          // native oxDNA2 relaxation (false: stop after the export)
    nativeIters?: number;
    threads?: number;          // 1 = single-thread build
    seed?: number;
    gpu?: 'auto' | 'off';      // WebGPU backend: accepted for forward compatibility; no WebGPU compute path exists yet, so every run is on the CPU (Rd2Result.gpu says so)
    extra?: string[];          // further rd2_run options, verbatim
}

interface Rd2Progress {
    type: 'progress';
    stage: string;             // "front end" | "coarse" | "export" | "native" | "recovery"
    step: number; steps: number;
    iter: number; maxIter: number;
    energy: number;
    text: string;
}

interface Rd2Result {
    rc: number;                // 0 gate met, 5 written but gate not met, 3 error
    top: string | null;
    dat: string | null;
    summary: any;              // <prefix>.summary.json of rd2_run (route, route_reason, nucleotides, native_energy_per_nt, gate_met, seconds_*, ...)
    log: string;
    seconds: number;           // wall time of the call inside the worker
    threads: number;
    variant: 'mt' | 'st';
    build: string;             // build id of the engine files that ran (wasm/rigiddna2/build.json)
    engine: string;
    gpu: { requested: boolean; used: boolean; reason: string };   // always used: false at present
}

interface Rd2GpuProbe {
    available: boolean;        // navigator.gpu gave an adapter and a device ran a compute shader
    adapter: string;           // vendor / architecture, "" when none
    software: boolean;         // the adapter is a software rasteriser (SwiftShader / llvmpipe), not a GPU
    note: string;
}

interface Rd2Capabilities {
    isolated: boolean;         // crossOriginIsolated: the threaded build can run
    cores: number;             // navigator.hardwareConcurrency
    webgpu: boolean;           // navigator.gpu present (the WebGPU compute path is not implemented yet, see docs/26_webassembly.md section 6)
}

class Rd2Engine {
    static baseUrl = 'wasm/rigiddna2/';
    private worker: Worker = null;
    private variant: 'mt' | 'st' = null;
    private maxThreads = 1;
    private nextId = 1;
    private reject: (e: Error) => void = null;

    static capabilities(): Rd2Capabilities {
        return {
            isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined',
            cores: navigator.hardwareConcurrency || 1,
            webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
        };
    }

    /** Threads the threaded build will use at most (its worker pool is min(cores, 8)). */
    static maxUsableThreads(): number {
        const c = Rd2Engine.capabilities();
        return c.isolated ? Math.min(c.cores, 8) : 1;
    }

    /**
     * Probes WebGPU: adapter, device and one tiny compute dispatch with read-back. This is what a WebGPU backend for the native FIRE relaxation would need;
     * the relaxation itself does not use it yet (docs/26_webassembly.md section 6).
     */
    static async probeGpu(): Promise<Rd2GpuProbe> {
        const none = (note: string): Rd2GpuProbe => ({ available: false, adapter: '', software: false, note });
        const gpu = (navigator as any).gpu;
        if (!gpu) return none('navigator.gpu is not defined (no WebGPU in this browser or context)');
        try {
            const ad = await gpu.requestAdapter();
            if (!ad) return none('no WebGPU adapter');
            const info = ad.info || {};
            const dev = await ad.requestDevice();
            const buf = dev.createBuffer({ size: 16, usage: 0x80 /* STORAGE */ | 0x04 /* COPY_SRC */ });
            const out = dev.createBuffer({ size: 16, usage: 0x01 /* MAP_READ */ | 0x08 /* COPY_DST */ });
            const mod = dev.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> d: array<f32>; @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) g: vec3<u32>) { d[g.x] = f32(g.x) * 2.0 + 1.0; }' });
            const pipe = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
            const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
            const enc = dev.createCommandEncoder();
            const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
            enc.copyBufferToBuffer(buf, 0, out, 0, 16);
            dev.queue.submit([enc.finish()]);
            await out.mapAsync(1 /* READ */);
            const r = Array.from(new Float32Array(out.getMappedRange()));
            const adapter = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
            const software = /swiftshader|llvmpipe|software|cpu/i.test(adapter) || !!ad.isFallbackAdapter;
            if (r.join() !== '1,3,5,7') return none('the compute shader returned a wrong result: ' + r.join());
            return { available: true, adapter, software, note: software ? 'adapter is a software rasteriser, not a GPU' : 'compute shader ran on the adapter' };
        } catch (e) {
            return none('WebGPU probe failed: ' + e);
        }
    }

    /**
     * Loads rd2_api.js (the script of the worker that turns an options object into the rd2_run command line) into the page too, so that the page can show the
     * exact command line of a run (Rd2Api.buildArgs is a pure function). Resolves once; a second call returns the same promise.
     */
    static loadApi(): Promise<void> {
        if ((window as any).Rd2Api) return Promise.resolve();
        if (!Rd2Engine.apiPromise) {
            Rd2Engine.apiPromise = new Promise<void>((resolve, reject) => {
                const s = document.createElement('script');
                s.src = new URL(Rd2Engine.baseUrl + 'rd2_api.js', document.baseURI).href;
                s.onload = () => resolve();
                s.onerror = () => { Rd2Engine.apiPromise = null; reject(new Error('rd2_api.js did not load')); };
                document.head.appendChild(s);
            });
        }
        return Rd2Engine.apiPromise;
    }
    private static apiPromise: Promise<void> = null;

    /** Build id of the engine files on the server (wasm/rigiddna2/build.json, always fetched fresh); '' when it cannot be read. */
    static async currentBuild(): Promise<{ build: string; engine: string }> {
        try {
            const r = await fetch(new URL(Rd2Engine.baseUrl + 'build.json', document.baseURI).href, { cache: 'no-store' });
            if (!r.ok) return { build: '', engine: '' };
            const j = await r.json();
            return { build: String(j.build || ''), engine: String(j.engine || '') };
        } catch (e) { return { build: '', engine: '' }; }
    }
    /** Build id and description of the engine the running worker was started with ('' before the first run). */
    build = ''; engine = '';

    private async start(variant: 'mt' | 'st'): Promise<void> {
        const base = new URL(Rd2Engine.baseUrl, document.baseURI).href;
        const cur = await Rd2Engine.currentBuild();
        this.build = cur.build; this.engine = cur.engine;
        const q = cur.build ? '?v=' + encodeURIComponent(cur.build) : '';
        this.worker = new Worker(base + 'rd2_worker.js' + q);
        this.variant = variant;
        return new Promise<void>((resolve, reject) => {
            this.reject = reject;
            this.worker.onmessage = (ev) => {
                if (ev.data.type === 'ready') { this.maxThreads = ev.data.threads; resolve(); }
                else if (ev.data.type === 'error') reject(new Error(ev.data.message));
            };
            this.worker.onerror = (ev) => reject(new Error(ev.message || 'worker failed to load'));
            this.worker.postMessage({ type: 'init', base, variant, v: cur.build });
        });
    }

    /** Terminates the worker: a running computation stops at once, the next run starts a fresh worker. */
    cancel() {
        if (this.worker) { this.worker.terminate(); this.worker = null; }
        if (this.reject) { this.reject(new Error('cancelled')); this.reject = null; }
    }

    /**
     * Runs one design. input.name decides the format (.json caDNAno, .sc scadnano, .top oxDNA with its configuration in input.dat).
     * Resolves with the oxDNA topology/configuration text and the summary; rejects with Error('cancelled') after cancel().
     */
    async run(input: { name: string; text: string; dat?: string }, opts: Rd2Options,
              onProgress?: (p: Rd2Progress) => void, onLog?: (line: string) => void): Promise<Rd2Result> {
        const wantThreads = Math.max(1, opts.threads || 1);
        const variant: 'mt' | 'st' = wantThreads > 1 && Rd2Engine.capabilities().isolated ? 'mt' : 'st';
        if (this.worker && this.variant !== variant) this.cancel();
        // a tab that stayed open across a deployment keeps its worker (and the old WebAssembly in it): start a new one when the server has another build
        if (this.worker) {
            const cur = await Rd2Engine.currentBuild();
            if (cur.build && this.build && cur.build !== this.build) this.cancel();
        }
        if (!this.worker) await this.start(variant);
        const worker = this.worker, id = this.nextId++;
        return new Promise<Rd2Result>((resolve, reject) => {
            this.reject = reject;
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.id !== id) return;
                if (m.type === 'progress') { if (onProgress) onProgress(m); }
                else if (m.type === 'log') { if (onLog) onLog(m.line); }
                else if (m.type === 'result') { this.reject = null; resolve({ rc: m.rc, top: m.top, dat: m.dat, summary: m.summary, log: m.log, seconds: m.seconds, threads: m.threads, variant, build: this.build, engine: this.engine,
                    gpu: { requested: opts.gpu === 'auto', used: false, reason: 'the relaxation has no WebGPU path: it ran on the CPU (WebAssembly)' } }); }
                else if (m.type === 'error') { this.reject = null; this.cancel(); reject(new Error(m.message)); }
            };
            worker.onerror = (ev) => { this.reject = null; this.cancel(); reject(new Error(ev.message || 'worker error')); };
            worker.postMessage({ type: 'run', id, name: input.name, text: input.text, dat: input.dat, options: Object.assign({}, opts, { threads: Math.min(wantThreads, variant === 'mt' ? this.maxThreads : 1) }) });
        });
    }
}
