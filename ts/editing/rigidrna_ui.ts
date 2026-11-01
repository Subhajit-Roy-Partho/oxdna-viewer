/**
 * rigidrna_ui.ts
 *
 * UI glue for the rigidRNA tab of windows/rigidDNAWindow.html: an RNA sequence and its dot-bracket structure go through the rigidRNA WebAssembly pipeline
 * (rigidrna_bridge.ts, in a Web Worker, with a log and cancel) and the resulting oxRNA2 .top/.dat load through the viewer's ordinary file path (handleFiles).
 */

let rrEngine: RnaEngine = new RnaEngine();
let rrRunning = false;

function rrEl<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }

function rrLog(line: string) {
    const el = rrEl('rrLog');
    if (!el) return;
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
}

function rrSetRunning(running: boolean) {
    rrRunning = running;
    rrEl<HTMLButtonElement>('rrRunBtn').disabled = running;
    rrEl<HTMLButtonElement>('rrCancelBtn').disabled = !running;
}

/** oncreate callback of view.createWindow('rigidDNAWindow', ...) via initRigidDnaHub */
function initRigidRnaWindow() {
    const threads = rrEl<HTMLInputElement>('rrThreads');
    const maxT = RnaEngine.maxUsableThreads();
    threads.max = String(Math.max(1, maxT));
    threads.value = String(Math.max(1, Math.min(maxT, 4)));
    threads.disabled = maxT <= 1;
    const cap = RnaEngine.capabilities();
    rrEl('rrEngine').innerHTML = cap.isolated
        ? `Multi-core build available (cross-origin isolated, ${cap.cores} logical cores, up to ${maxT} threads).`
        : `Single-thread build (this page is not cross-origin isolated). <a href="#" onclick="rd2EnableIsolation(); return false;">Enable multi-core via service worker (reloads the page)</a>`;
    rrSaltChanged();
    rrSetRunning(false);
}

/** "Load example" button: a dumbbell of two 7 bp hairpins joined by a 4 nt linker (a minimal two-stem design). */
function rrExample() {
    rrEl<HTMLTextAreaElement>('rrSeq').value = 'GGGCGCGAAAACGCGCCCAAAAGGGCGCGAAAACGCGCCC';
    rrEl<HTMLTextAreaElement>('rrDb').value  = '(((((((....)))))))....(((((((....)))))))';
}

/** Shows the Debye length of the chosen salt (oxRNA2: 0.3667 * sqrt(T/300 K) / sqrt(I) oxRNA units of 0.8518 nm). */
function rrSaltChanged() {
    const salt = parseFloat(rrEl<HTMLInputElement>('rrSalt').value), temp = parseFloat(rrEl<HTMLInputElement>('rrTemp').value) || 300;
    const el = rrEl('rrDebye');
    if (!(salt > 0)) { el.textContent = ''; return; }
    el.textContent = `Debye length ${(0.3667258 * Math.sqrt(temp / 300) / Math.sqrt(salt) * 0.8518).toFixed(2)} nm`;
}

function rrOptions(): RnaOptions {
    return {
        salt: parseFloat(rrEl<HTMLInputElement>('rrSalt').value) || 0.5,
        temp: parseFloat(rrEl<HTMLInputElement>('rrTemp').value) || 300,
        elec: rrEl<HTMLInputElement>('rrElec').checked,
        iters: parseInt(rrEl<HTMLInputElement>('rrIters').value) || 300,
        threads: parseInt(rrEl<HTMLInputElement>('rrThreads').value) || 1,
    };
}

/** "Build and load" button. */
async function rrRun() {
    if (rrRunning) return;
    const seq = rrEl<HTMLTextAreaElement>('rrSeq').value.replace(/\s+/g, '').toUpperCase().replace(/T/g, 'U');
    const db = rrEl<HTMLTextAreaElement>('rrDb').value.replace(/\s+/g, '');
    if (!seq || seq.length !== db.length) { notify(`The sequence (${seq.length} nt) and the dot-bracket (${db.length} characters) must have the same length.`, 'alert'); return; }
    if (/[^ACGU]/.test(seq)) { notify('The sequence may contain only A, C, G, U (T is read as U).', 'alert'); return; }
    rrEl('rrLog').textContent = '';
    rrEl('rrSummary').innerHTML = '';
    const label = rrEl('rrStage');
    rrSetRunning(true);
    const t0 = performance.now();
    try {
        label.textContent = 'Starting the engine...';
        const r = await rrEngine.run({ seq, db }, rrOptions(), (line) => {
            rrLog(line);
            const m = /^\[[\d.]+s\] (.*)$/.exec(line) || /^\s*(stage .*)$/.exec(line);
            if (m) label.textContent = m[1].slice(0, 110);
        });
        label.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s (${r.variant === 'mt' ? r.threads + ' threads' : 'single thread'}).`;
        rrShowSummary(r);
        if (r.rc !== 0 || !r.top || !r.dat) { notify('rigidRNA produced no structure: ' + (r.log.split('\n').filter(l => /error|unknown|cannot/i.test(l)).pop() || 'see the log'), 'alert'); return; }
        handleFiles([new File([r.top], 'rigidRNA.top'), new File([r.dat], 'rigidRNA.dat')]);
    } catch (e) {
        label.textContent = e.message === 'cancelled' ? 'Cancelled.' : 'Failed: ' + e.message;
        if (e.message !== 'cancelled') notify('rigidRNA failed: ' + e.message, 'alert');
    } finally {
        rrSetRunning(false);
    }
}

/** "Cancel" button: stops the worker. */
function rrCancel() { if (rrRunning) rrEngine.cancel(); }

function rrShowSummary(r: RnaResult) {
    const rep = r.report;
    if (!rep) return;
    const row = (k: string, v: any) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const rel = rep.relaxed || {};
    const f = (x: number) => (x === undefined ? '-' : x.toPrecision(3));
    let h = '<table class="table compact row-hover">' +
        row('nucleotides', rep.n_nt) +
        row('model energy (oxRNA units, 1 = 10 kT)', `step ${f(rel.step)}, cable ${f(rel.cable)}, repulsion ${f(rel.rep)}${rel.elec !== undefined ? ', electrostatic ' + f(rel.elec) : ''}, total ${f(rel.total)}`);
    if (rep.elec) h += row('electrostatics', `oxRNA2 Debye-Hueckel, ${rep.elec.salt} M, Debye length ${(rep.elec.lambda * 0.8518).toFixed(2)} nm, ${rep.elec.site_pairs} charged site pairs`);
    if (rep.substructures) h += row('stems / loops', `${rep.substructures.stems} / ${rep.substructures.loops}`);
    h += row('flags', `${(rep.flags || []).length}`) + row('time', `${(rep.seconds || 0).toFixed(1)} s in the engine, ${r.seconds.toFixed(1)} s with I/O`) + '</table>';
    rrEl('rrSummary').innerHTML = h;
}
