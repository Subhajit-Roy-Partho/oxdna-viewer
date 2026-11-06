/**
 * seqpred_bridge.ts
 *
 * Page-side wrapper around the seqpred WebAssembly module (wasm/seqpred/, built from rigidDNA2 branch seqpred-cpp: src/seqpred + ViennaRNA 2.7.2 compiled with Emscripten):
 * an RNA sequence goes in, the predicted secondary structure comes out (nested Turner 2004 MFE with the salt correction of ViennaRNA 2.7, plus the kissing / pseudoknot
 * layer of predictor v2). Like the rigidRNA bridge the computation is one long synchronous call, so it runs inside a Web Worker (wasm/seqpred/seqpred_worker.js); cancelling
 * terminates the worker. The build id (wasm/seqpred/build.json, the hash of the two .wasm files, written by tools/rd2wasm-e2e/stamp_seqpred_build.mjs) goes into every URL and into
 * the result, so the summary can say which build produced a structure.
 */

interface SeqpredOptions {
    method?: 'v2' | 'v3' | 'v4' | 'm2' | 'h2d' | 'ml2' | 'ml3' | 'ms2' | 'msrna' | 'dna' | 'ssdna' | 'nested' | 'rna_kl' | 'kl_routes' | 'longrange' | 'cassette';
    model?: 'v2' | 'v3' | 'v4' | 'm2' | 'h2d' | 'ml2' | 'ml3';   // single-chain RNA predictor choice (GOAL 1); mapped to method for the builds that carry it
    salt?: number;            // mol/l (default 0.25)
    budgetSeconds?: number;   // bounds EVERY stage (new semantics): the result then has truncated: true, a note and timings.truncatedAt = the stage name
    maxLength?: number;       // longer sequences get the nested MFE only (default 1500)
    threads?: number;         // threaded build only (all single-chain models; not ms2)
    gate?: number;            // msrna: strands of at least this many nt keep their own fold and are linked by kissing helices (default 50)
    gateMargin?: number;      // m2, h2d: score margin a crossing candidate must win by (defaults m2 2, h2d 4; 1e9 disables the gate)
    thr?: number;             // ml2, ml3: discriminator probability threshold (default 0.7)
    molecule?: 'auto' | 'RNA' | 'DNA';   // ms2 only
    temp?: number;            // ms2 only, deg C
    declaredAssembly?: boolean;   // ms2 only (default true: every strand must touch another strand)
    kissPrior?: boolean;      // ms2 only (default true, RNA)
    g4?: boolean;             // ms2 only (default true, DNA: G-quadruplex tracts are protected from pairing)
    msdna?: boolean;          // ms2 only (default true: MS-RNA with DNA energetics as a second DNA state)
}

interface SeqpredResult {
    ok: boolean;
    sequence: string; length: number; method: string; salt: number;
    dotbracket: string;                                 // nested (), crossing layers [] {} <>
    pairs: [number, number][]; layers: number[];        // 1-based
    helices: { i: number; j: number; k: number }[];     // long-range helices
    top?: { helices: [number, number, number][]; hostSource: string; rank: number; score: number; dotbracket?: string; pairs?: [number, number][]; layers?: number[] }[];   // ranked candidates (current build: helices + score only)
    nCandidates?: number;                                         // how many candidates competed
    energy: { nestedMfe?: number; nestedDotbracket?: string; hostEnergy?: number; hostDotbracket?: string; hostSource?: string; score?: number; freeEnergy?: number; mfeA?: number; mfe?: number; mea?: number };   // dna: mfeA (ViennaRNA-DNA MFE of the best strand order); ssdna: mfe, mea   // msrna: freeEnergy (kcal/mol of the complex partition), no nested MFE
    confidence?: { model: string; status: string; marginNested?: number | null; marginOther?: number | null; nExtraHelices?: number; ruleFired?: string; helices?: { i: number; j: number; k: number; rules: string[]; lpc?: number | null }[]; reason?: string; pCross?: number };   // every single-chain model result (newer builds)
    route?: string;           // ms2: which branch decided
    molecule?: string;        // ms2: RNA or DNA
    g4?: { tracts: number[][][]; L: number; loops: number[] };   // ms2 (DNA): protected G-quadruplex tracts
    kissPrior?: { fired: boolean; dF: number; Lk: number; Lintra: number };   // ms2 (RNA)
    strands?: string[]; lengths?: number[];             // msrna: the strands (pairs are global over their concatenation, dotbracket has '&' between strands)
    temp?: number;                                      // dna / ssdna / ms2: temperature (deg C)
    primary?: string;                                   // msrna: 'kiss' or 'default'
    alternatives?: { name: string; F: number; dotbracket: string; pairs: [number, number][]; layers: number[] }[];   // msrna: other states with a different pairing
    notes: string[]; truncated: boolean; capped?: boolean;
    timings: { [k: string]: any };   // engine seconds (total); truncatedAt: the stage the time budget stopped (new semantics), when truncated
    version: { seqpred: string; buildId: string; git: string; viennarna: string; parameters: string; predictor: string; models?: string[] | { [k: string]: { label?: string; status?: string; note?: string; available?: boolean; needs?: string; tradeoff?: string; options?: string[] } } };
    build: { build: string; engine: string } | null;    // wasm/seqpred/build.json
    variant: 'mt' | 'st';
    wallSeconds: number;
    loadSeconds: number;      // page-measured module loading time: creating the worker to 'ready' (0 when the worker was already warm)
}

class SeqpredEngine {
    static baseUrl = 'wasm/seqpred/';
    private worker: Worker = null;
    private variant: 'mt' | 'st' = null;
    private readyVersion: any = null;   // seqpred_version of the loaded module (set by start())
    private loadSeconds = 0;            // module loading time of the current worker: creating it to 'ready'
    private nextId = 1;
    private reject: (e: Error) => void = null;
    private static buildPromise: Promise<{ build: string; engine: string } | null> = null;

    /** True when the loaded module build carries the model id (version.models block or probe). A model missing from the object is not in this build. */
    static modelSupported(v: any, id: string): boolean {
        if (!v) return false;
        const mm = (v as any).models;
        if (Array.isArray(mm) && mm.indexOf(id) >= 0) return true;
        if (mm && typeof mm === 'object' && !Array.isArray(mm) && Object.prototype.hasOwnProperty.call(mm, id)) {
            const e = (mm as any)[id];
            if (e && typeof e === 'object' && (e as any).available === false) return false;   // listed but not in this build
            return true;
        }
        if (id === 'm2') return /m2/i.test([(v as any).predictor, (v as any).seqpred].filter(Boolean).join(' '));
        return false;
    }

    /** True when the loaded module build carries the M2 re-ranker (version block or probe). */
    static m2Supported(v: any): boolean { return SeqpredEngine.modelSupported(v, 'm2'); }

    /** wasm/seqpred/build.json (never cached); null when the module is not deployed. */
    static buildInfo(): Promise<{ build: string; engine: string } | null> {
        if (!SeqpredEngine.buildPromise) {
            SeqpredEngine.buildPromise = fetch(new URL(SeqpredEngine.baseUrl + 'build.json', document.baseURI).href, { cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        }
        return SeqpredEngine.buildPromise;
    }

    private async start(variant: 'mt' | 'st'): Promise<void> {
        const info = await SeqpredEngine.buildInfo();
        const base = new URL(SeqpredEngine.baseUrl, document.baseURI).href;
        const q = info && info.build ? '?v=' + encodeURIComponent(info.build) : '';
        this.worker = new Worker(base + 'seqpred_worker.js' + q);
        this.variant = variant;
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this.loadSeconds = 0;
        return new Promise<void>((resolve, reject) => {
            this.reject = reject;
            this.worker.onmessage = (ev) => {
                if (ev.data.type === 'ready') {
                    this.variant = ev.data.variant; this.readyVersion = ev.data.version || null;
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    this.loadSeconds = (now - t0) / 1000;
                    resolve();
                }
                else if (ev.data.type === 'error') reject(new Error(ev.data.message));
            };
            this.worker.onerror = (ev) => reject(new Error(ev.message || 'worker failed to load'));
            this.worker.postMessage({ type: 'init', base, variant, build: info ? info.build : '' });
        });
    }

    /** Terminates the worker: a running computation stops at once, the next run starts a fresh worker. */
    cancel() {
        if (this.worker) { this.worker.terminate(); this.worker = null; }
        if (this.reject) { this.reject(new Error('cancelled')); this.reject = null; }
    }

    /** The version block of the loaded module (starts the worker when needed). */
    async versionInfo(): Promise<any> {
        if (!this.worker) await this.start('st');
        return this.readyVersion;
    }

    /** Predicts the structure of one sequence; rejects with Error('cancelled') after cancel(). */
    async predict(sequence: string, opts: SeqpredOptions): Promise<SeqpredResult> {
        const wantMt = (opts.threads || 1) > 1 && RnaEngine.capabilities().isolated;
        const variant: 'mt' | 'st' = wantMt ? 'mt' : 'st';
        if (this.worker && this.variant !== variant) this.cancel();
        const warm = !!this.worker;
        if (!this.worker) await this.start(variant);
        // Backwards compatibility: the single-chain predictor used to be chosen by method alone
        // (method v2/v3); the model field is new. Old callers without options.model still get v2.
        // Any single-chain model missing from the loaded build is refused here (the tab disables it too).
        const o = Object.assign({}, opts);
        if (!o.method && !o.model) o.method = 'v2';
        else if (o.model && (!o.method || ['v2', 'v3', 'v4', 'm2', 'h2d', 'ml2', 'ml3'].indexOf(o.method) >= 0)) {
            if (!SeqpredEngine.modelSupported(this.readyVersion, o.model))
                throw new Error('The ' + o.model.toUpperCase() + ' model is not in this seqpred build (' + (this.readyVersion && this.readyVersion.predictor ? this.readyVersion.predictor : 'no version') + '): v2 remains the validated predictor.');
            o.method = o.model as SeqpredOptions['method'];
        }
        if (o.method && ['v2', 'v3', 'v4', 'm2', 'h2d', 'ml2', 'ml3'].indexOf(o.method) >= 0 && !SeqpredEngine.modelSupported(this.readyVersion, o.method))
            throw new Error('The ' + String(o.method).toUpperCase() + ' model is not in this seqpred build: v2 remains the validated predictor.');
        const info = await SeqpredEngine.buildInfo();
        const loadSeconds = warm ? 0 : this.loadSeconds;
        const worker = this.worker, id = this.nextId++;
        return new Promise<SeqpredResult>((resolve, reject) => {
            this.reject = reject;
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.id !== id) return;
                if (m.type === 'result') { this.reject = null; resolve(Object.assign({}, m.result, { build: info, variant: this.variant, wallSeconds: m.wallSeconds, loadSeconds })); }
                else if (m.type === 'error') { this.reject = null; this.cancel(); reject(new Error(m.message)); }
            };
            worker.onerror = (ev) => { this.reject = null; this.cancel(); reject(new Error(ev.message || 'worker error')); };
            worker.postMessage({ type: 'predict', id, sequence, options: o });
        });
    }
}
