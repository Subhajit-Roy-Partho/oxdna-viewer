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
    method?: 'v2' | 'v3' | 'm2' | 'msrna' | 'dna' | 'ssdna' | 'nested' | 'rna_kl' | 'kl_routes' | 'longrange' | 'cassette';
    model?: 'v2' | 'v3' | 'm2';   // single-chain RNA predictor choice (GOAL 1); mapped to method for the current build
    salt?: number;            // mol/l (default 0.25)
    budgetSeconds?: number;   // stop starting new host-refinement rounds after this time (0 = unlimited)
    maxLength?: number;       // longer sequences get the nested MFE only (default 1500)
    threads?: number;         // threaded build only
    gate?: number;            // msrna: strands of at least this many nt keep their own fold and are linked by kissing helices (default 50)
}

interface SeqpredResult {
    ok: boolean;
    sequence: string; length: number; method: string; salt: number;
    dotbracket: string;                                 // nested (), crossing layers [] {} <>
    pairs: [number, number][]; layers: number[];        // 1-based
    helices: { i: number; j: number; k: number }[];     // long-range helices
    top?: { helices: [number, number, number][]; hostSource: string; rank: number; score: number; dotbracket?: string; pairs?: [number, number][]; layers?: number[] }[];   // ranked candidates (current build: helices + score only)
    nCandidates?: number;                                         // how many candidates competed
    energy: { nestedMfe?: number; nestedDotbracket?: string; score?: number; freeEnergy?: number; mfeA?: number; mfe?: number; mea?: number };   // dna: mfeA (ViennaRNA-DNA MFE of the best strand order); ssdna: mfe, mea   // msrna: freeEnergy (kcal/mol of the complex partition), no nested MFE
    strands?: string[]; lengths?: number[];             // msrna: the strands (pairs are global over their concatenation, dotbracket has '&' between strands)
    temp?: number;                                      // dna / ssdna: temperature (deg C)
    primary?: string;                                   // msrna: 'kiss' or 'default'
    alternatives?: { name: string; F: number; dotbracket: string; pairs: [number, number][]; layers: number[] }[];   // msrna: other states with a different pairing
    notes: string[]; truncated: boolean; capped?: boolean;
    timings: { [k: string]: any };
    version: { seqpred: string; buildId: string; git: string; viennarna: string; parameters: string; predictor: string; models?: string[] };
    build: { build: string; engine: string } | null;    // wasm/seqpred/build.json
    variant: 'mt' | 'st';
    wallSeconds: number;
}

class SeqpredEngine {
    static baseUrl = 'wasm/seqpred/';
    private worker: Worker = null;
    private variant: 'mt' | 'st' = null;
    private readyVersion: any = null;   // seqpred_version of the loaded module (set by start())
    private nextId = 1;
    private reject: (e: Error) => void = null;
    private static buildPromise: Promise<{ build: string; engine: string } | null> = null;

    /** True when the loaded module build carries the M2 re-ranker (version block or probe). */
    static m2Supported(v: any): boolean {
        if (!v) return false;
        if (Array.isArray((v as any).models) && (v as any).models.indexOf('m2') >= 0) return true;
        return /m2/i.test([v.predictor, v.seqpred].filter(Boolean).join(' '));
    }

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
        return new Promise<void>((resolve, reject) => {
            this.reject = reject;
            this.worker.onmessage = (ev) => {
                if (ev.data.type === 'ready') { this.variant = ev.data.variant; this.readyVersion = ev.data.version || null; resolve(); }
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
        if (!this.worker) await this.start(variant);
        // Backwards compatibility: the single-chain predictor used to be chosen by method alone
        // (method v2/v3); the model field is new. Old callers without options.model still get v2.
        const o = Object.assign({}, opts);
        if (!o.method && !o.model) o.method = 'v2';
        else if (o.model && (!o.method || ['v2', 'v3', 'm2'].indexOf(o.method) >= 0)) {
            if (o.model === 'm2') {
                if (!SeqpredEngine.m2Supported(this.readyVersion))
                    throw new Error('The M2 model is not in this seqpred build (' + (this.readyVersion && this.readyVersion.predictor ? this.readyVersion.predictor : 'no version') + '): v2 remains the validated predictor.');
                o.method = 'm2';
            } else o.method = o.model;
        }
        if ((o as any).method === 'm2' && !SeqpredEngine.m2Supported(this.readyVersion))
            throw new Error('The M2 model is not in this seqpred build: v2 remains the validated predictor.');
        const info = await SeqpredEngine.buildInfo();
        const worker = this.worker, id = this.nextId++;
        return new Promise<SeqpredResult>((resolve, reject) => {
            this.reject = reject;
            worker.onmessage = (ev) => {
                const m = ev.data;
                if (m.id !== id) return;
                if (m.type === 'result') { this.reject = null; resolve(Object.assign({}, m.result, { build: info, variant: this.variant, wallSeconds: m.wallSeconds })); }
                else if (m.type === 'error') { this.reject = null; this.cancel(); reject(new Error(m.message)); }
            };
            worker.onerror = (ev) => { this.reject = null; this.cancel(); reject(new Error(ev.message || 'worker error')); };
            worker.postMessage({ type: 'predict', id, sequence, options: o });
        });
    }
}
