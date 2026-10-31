/**
 * rigiddna2_ui.ts
 *
 * UI glue for the rigidDNA2 tab of windows/rigidDNAWindow.html: choose (or drop) a caDNAno / scadnano design, run the rigidDNA2 WebAssembly pipeline
 * (rigiddna2_bridge.ts, in a Web Worker, with progress and cancel) and load the relaxed oxDNA .top/.dat through the viewer's ordinary file path
 * (handleFiles), so the result is a normal system in the scene.
 */

let rd2Engine: Rd2Engine = new Rd2Engine();
let rd2Design: { name: string; text: string; dat?: string } = null;
let rd2Running = false;

function rd2El<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

function rd2Log(line: string) {
    const el = rd2El('rd2Log');
    if (!el) return;
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
}

function rd2SetRunning(running: boolean) {
    rd2Running = running;
    rd2El<HTMLButtonElement>('rd2RunBtn').disabled = running || rd2Design === null;
    rd2El<HTMLButtonElement>('rd2CancelBtn').disabled = !running;
}

/** Overall progress in 0..1 from the stage events of the engine (indicative: the coarse and native stages have no fixed length). */
function rd2Fraction(p: Rd2Progress): number {
    const part = (a: number, b: number, f: number) => a + (b - a) * Math.max(0, Math.min(1, f));
    switch (p.stage) {
        case 'front end': return 0.02;
        case 'coarse': {
            if (p.steps > 0) { rd2CoarseStep = p.step; rd2CoarseSteps = p.steps; }
            const inStage = p.maxIter > 0 ? p.iter / p.maxIter : 0;
            return part(0.03, 0.70, (rd2CoarseStep + inStage) / Math.max(1, rd2CoarseSteps));
        }
        case 'export': return 0.72;
        case 'native': return p.maxIter > 0 ? part(0.75, 0.97, p.iter / p.maxIter) : 0.75;
        case 'recovery': return 0.97;
        default: return 0;
    }
}
let rd2CoarseStep = 0, rd2CoarseSteps = 1;

function rd2StageLabel(p: Rd2Progress): string {
    switch (p.stage) {
        case 'front end': return 'Reading the design';
        case 'coarse': return `Coarse rigid-body relaxation${p.steps > 0 ? ` (stage ${p.step + 1}/${p.steps})` : ''}${p.energy ? `, E ${p.energy.toPrecision(4)}` : ''}`;
        case 'export': return 'Building nucleotides';
        case 'native': return `oxDNA2 relaxation, iteration ${p.iter}${p.energy ? `, E/nt ${p.energy.toFixed(3)}` : ''}`;
        case 'recovery': return `Recovery: ${p.text}`;
        default: return p.text || p.stage;
    }
}

/** oncreate callback of view.createWindow('rigidDNAWindow', ...) via initRigidDnaHub */
function initRigidDna2Window() {
    const cap = Rd2Engine.capabilities();
    const threads = rd2El<HTMLInputElement>('rd2Threads');
    const maxT = Rd2Engine.maxUsableThreads();
    threads.max = String(Math.max(1, maxT));
    threads.value = String(Math.max(1, Math.min(maxT, 4)));
    threads.disabled = maxT <= 1;
    const info = rd2El('rd2Engine');
    info.innerHTML = cap.isolated
        ? `Multi-core build available (cross-origin isolated, ${cap.cores} logical cores, up to ${maxT} threads).`
        : `Single-thread build (this page is not cross-origin isolated, so SharedArrayBuffer and threads are unavailable). ` +
          `<a href="#" onclick="rd2EnableIsolation(); return false;">Enable multi-core via service worker (reloads the page)</a>`;
    rd2El('rd2Gpu').textContent = cap.webgpu ? 'Checking WebGPU...' : 'WebGPU not available; the relaxation runs on the CPU (WebAssembly).';
    if (cap.webgpu) Rd2Engine.probeGpu().then((g) => {
        rd2El('rd2Gpu').textContent = (g.available ? `WebGPU: ${g.adapter || 'adapter'}${g.software ? ' (software)' : ''}. ` : `WebGPU: ${g.note}. `) +
            'The relaxation has no WebGPU path yet and runs on the CPU (WebAssembly).';
    });
    const drop = rd2El('rd2Drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('rd2-over'); };
    drop.ondragleave = () => drop.classList.remove('rd2-over');
    drop.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('rd2-over'); rd2Files(Array.from(e.dataTransfer.files)); };
    if (rd2Pending) { const f = rd2Pending; rd2Pending = null; rd2Files([f]); }
    rd2SetRunning(false);
}

/** Design waiting for the window to be created (see rd2OfferDesign). */
let rd2Pending: File = null;

/** "Choose file" input of the window. */
function rd2Choose(input: HTMLInputElement) { rd2Files(Array.from(input.files)); input.value = ''; }

/** Takes a design file (caDNAno .json, scadnano .sc) and, for an oxDNA .top, its .dat when both were given. */
async function rd2Files(files: File[]) {
    const main = files.find(f => /\.(json|sc|top)$/i.test(f.name));
    if (!main) { notify('rigidDNA2 reads a caDNAno .json, a scadnano .sc or an oxDNA .top (with its .dat).', 'alert'); return; }
    const d: { name: string; text: string; dat?: string } = { name: main.name, text: await main.text() };
    if (/\.top$/i.test(main.name)) {
        const dat = files.find(f => /\.(dat|conf|oxdna)$/i.test(f.name));
        if (!dat) { notify('An oxDNA topology needs its configuration (.dat) too: select both files.', 'alert'); return; }
        d.dat = await dat.text();
    }
    rd2Design = d;
    rd2El('rd2File').textContent = `${d.name} (${(d.text.length / 1024).toFixed(0)} kB)`;
    rd2SetRunning(false);
}

/**
 * Called by handleFiles for a dropped .json / .sc file: a caDNAno or scadnano design is not something the viewer can read itself, so it is offered
 * to the rigidDNA2 tab (which then holds it, ready to run). Returns true when the file was taken.
 */
async function rd2OfferDesign(file: File): Promise<boolean> {
    const lower = file.name.toLowerCase();
    let isDesign = lower.endsWith('.sc');
    if (!isDesign && lower.endsWith('.json')) {
        const head = await file.slice(0, 65536).text();
        isDesign = head.indexOf('"vstrands"') >= 0;
    }
    if (!isDesign) return false;
    notify(`${file.name} is a DNA origami design: opening the rigidDNA2 tab to relax it in your browser.`);
    const w = document.getElementById('rigidDNAWindow');
    if (!w) {
        rd2Pending = file;   // taken by initRigidDna2Window once the window exists
        rigidDnaOpen(2);
    } else {
        if (rigidDnaHubTab !== 2 || w.style.display === 'none') { Metro.window.show(w); rigidDnaShowTab(2); }
        rd2Files([file]);
    }
    return true;
}

function rd2Options(): Rd2Options {
    const threads = parseInt(rd2El<HTMLInputElement>('rd2Threads').value) || 1;
    return {
        route: rd2El<HTMLSelectElement>('rd2Route').value as Rd2Options['route'],
        inferStaples: rd2El<HTMLSelectElement>('rd2Infer').value as Rd2Options['inferStaples'],
        native: rd2El<HTMLInputElement>('rd2Native').checked,
        threads,
    };
}

/** "Relax" button. */
async function rd2Run() {
    if (!rd2Design || rd2Running) return;
    rd2El('rd2Log').textContent = '';
    rd2El('rd2Summary').innerHTML = '';
    const bar = rd2El<HTMLProgressElement>('rd2Bar'), label = rd2El('rd2Stage');
    bar.value = 0;
    rd2CoarseStep = 0; rd2CoarseSteps = 1;
    rd2SetRunning(true);
    const t0 = performance.now();
    try {
        label.textContent = 'Starting the engine...';
        const r = await rd2Engine.run(rd2Design, rd2Options(), (p) => {
            bar.value = rd2Fraction(p);
            label.textContent = rd2StageLabel(p);
        }, (line) => rd2Log(line));
        bar.value = 1;
        label.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s (${r.variant === 'mt' ? r.threads + ' threads' : 'single thread'}).`;
        rd2ShowSummary(r);
        if (!r.top || !r.dat) { notify('rigidDNA2 produced no structure: ' + (r.log.split('\n').filter(l => l.startsWith('ERROR')).pop() || 'see the log'), 'alert'); return; }
        if (r.rc !== 0) notify('The relaxed structure was written but did not meet the safety gate (see the summary).', 'warn');
        const base = rd2Design.name.replace(/\.[^.]+$/, '');
        handleFiles([new File([r.top], base + '.top'), new File([r.dat], base + '.dat')]);
    } catch (e) {
        label.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Failed: ' + e.message;
        if (e.message !== 'cancelled') notify('rigidDNA2 failed: ' + e.message, 'alert');
    } finally {
        rd2SetRunning(false);
    }
}

/** "Cancel" button: stops the worker. */
function rd2Cancel() { if (rd2Running) rd2Engine.cancel(); }

function rd2ShowSummary(r: Rd2Result) {
    const s = r.summary;
    if (!s) return;
    const row = (k: string, v: any) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    rd2El('rd2Summary').innerHTML = '<table class="table compact row-hover">' +
        row('route', `${s.route} <span class="text-muted text-small">(${s.route_reason})</span>`) +
        row('nucleotides', s.nucleotides) +
        row('E / nt (oxDNA2)', s.native_energy_per_nt !== undefined ? s.native_energy_per_nt.toFixed(4) : 'native relaxation off') +
        row('safety gate', s.gate_met ? 'met' : '<b>not met</b>: ' + s.gate_message) +
        row('time', `${s.seconds_total.toFixed(1)} s in the engine, ${r.seconds.toFixed(1)} s with I/O`) + '</table>';
}

/** Registers coi-serviceworker.js (adds COOP/COEP in the page's name) and reloads: makes the page cross-origin isolated when the server sends no such headers. */
async function rd2EnableIsolation() {
    if (!('serviceWorker' in navigator)) { notify('Service workers are not available here.', 'alert'); return; }
    try {
        await navigator.serviceWorker.register('coi-serviceworker.js');
        await navigator.serviceWorker.ready;
        // the reload must be answered by the worker: wait until it controls the page (it claims its clients on activation)
        if (!navigator.serviceWorker.controller) {
            await new Promise<void>(resolve => {
                navigator.serviceWorker.addEventListener('controllerchange', () => resolve());
                setTimeout(resolve, 3000);
            });
        }
        window.location.reload();
    } catch (e) {
        notify('Could not register the service worker: ' + e.message, 'alert');
    }
}
