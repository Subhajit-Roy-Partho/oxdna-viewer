#!/usr/bin/env node
/**
 * rd2wasm-e2e — end-to-end check of the rigidDNA2 WebAssembly window in a real (headless) Chromium.
 *
 * Serves the viewer root on a scratch port (with COOP/COEP headers unless --no-isolation), opens index.html, drives the rigidDNA2 window the way a user
 * does (file input, Run), waits for the relaxed structure to appear in the scene, and writes a full-page screenshot and a canvas screenshot fitted to the
 * structure, plus a JSON record (engine variant, threads, summary, wall times). Nothing is changed in the repo.
 *
 *   node e2e.mjs --design <file.json|.sc> --out <prefix> [--threads N] [--no-isolation] [--sw] [--drop] [--cancel-after MS] [--gpu-probe]
 *                [--route R] [--infer on|off|auto] [--linkers auto|on|off] [--timeout MS] [--port N] [--width W --height H]
 * --drop: hand the design to the viewer's own file handler (what a drop on the page does) instead of the window's file input.
 * --sw: serve without the headers, click "Enable multi-core via service worker" and run after the reload.
 * Needs playwright-core (tools/oxview-render/node_modules or PLAYWRIGHT_CORE) and a Chromium in ~/.cache/ms-playwright (or CHROME_PATH).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const o = { threads: 1, timeout: 600000, port: 8921, width: 1280, height: 800, route: "auto", infer: "auto" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--design") o.design = argv[++i];
  else if (a === "--out") o.out = argv[++i];
  else if (a === "--threads") o.threads = parseInt(argv[++i], 10);
  else if (a === "--timeout") o.timeout = parseInt(argv[++i], 10);
  else if (a === "--port") o.port = parseInt(argv[++i], 10);
  else if (a === "--width") o.width = parseInt(argv[++i], 10);
  else if (a === "--height") o.height = parseInt(argv[++i], 10);
  else if (a === "--route") o.route = argv[++i];
  else if (a === "--infer") o.infer = argv[++i];
  else if (a === "--linkers") o.linkers = argv[++i];
  else if (a === "--cancel-after") o.cancelAfter = parseInt(argv[++i], 10);
  else if (a === "--no-isolation") o.noIso = true;
  else if (a === "--sw") { o.sw = true; o.noIso = true; }
  else if (a === "--gpu-probe") o.gpuProbe = true;
  else if (a === "--drop") o.drop = true;
  else { console.error("unknown option " + a); process.exit(2); }
}
if (!o.out || (!o.design && !o.gpuProbe)) { console.error("usage: e2e.mjs --design FILE --out PREFIX [options]"); process.exit(2); }

function loadPlaywright() {
  const cands = [process.env.PLAYWRIGHT_CORE, path.join(ROOT, "tools/oxview-render/node_modules/playwright-core"),
    "/home/subho/Documents/Github/oxdna-viewer/tools/oxview-render/node_modules/playwright-core"].filter(Boolean);
  for (const c of cands) { try { return createRequire(import.meta.url)(c); } catch { /* next */ } }
  console.error("playwright-core not found (npm install in tools/oxview-render)"); process.exit(2);
}
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  const dirs = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) { const e = path.join(cache, d, "chrome-linux64", "chrome"); if (fs.existsSync(e)) return e; }
  console.error("no Chromium found"); process.exit(2);
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  const h = { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" };
  if (!o.noIso) Object.assign(h, { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless", "Cross-Origin-Resource-Policy": "cross-origin" });
  res.writeHead(200, h);
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(o.port, "127.0.0.1", r));

const { chromium } = loadPlaywright();
const args = ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage"];
if (o.gpuProbe) args.push("--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=vulkan", "--ignore-gpu-blocklist");
const extra = (process.env.CHROME_ARGS || "").split(" ").filter(Boolean);   // e.g. flags that select the real GPU for WebGPU
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: (o.gpuProbe ? args.filter((a) => a !== "--use-angle=swiftshader") : args).concat(extra) });
const rec = { design: o.design && path.basename(o.design), threadsRequested: o.threads, isolationHeaders: !o.noIso };
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: o.width, height: o.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.stack) || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function", null, { timeout: 120000 });

  if (o.gpuProbe) {
    rec.webgpu = await page.evaluate(async () => {
      const r = { navigatorGpu: "gpu" in navigator };
      if (!r.navigatorGpu) return r;
      try {
        const ad = await navigator.gpu.requestAdapter();
        r.adapter = !!ad;
        if (ad) {
          r.info = ad.info ? { vendor: ad.info.vendor, architecture: ad.info.architecture, description: ad.info.description } : null;
          const dev = await ad.requestDevice();
          const buf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
          const out = dev.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
          const mod = dev.createShaderModule({ code: "@group(0) @binding(0) var<storage, read_write> d: array<f32>; @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) g: vec3<u32>) { d[g.x] = f32(g.x) * 2.0 + 1.0; }" });
          const pipe = dev.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "main" } });
          const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
          const enc = dev.createCommandEncoder();
          const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(1); p.end();
          enc.copyBufferToBuffer(buf, 0, out, 0, 16);
          dev.queue.submit([enc.finish()]);
          await out.mapAsync(GPUMapMode.READ);
          r.computeResult = Array.from(new Float32Array(out.getMappedRange()));
        }
      } catch (e) { r.error = String(e); }
      return r;
    });
    console.log(JSON.stringify(rec));
    fs.writeFileSync(o.out + ".json", JSON.stringify(rec, null, 1));
    if (!o.design) { await browser.close(); srv.close(); process.exit(0); }
  }

  if (o.sw) {   // no headers: the page is not isolated; the window offers the service worker, which reloads the page
    rec.isolatedBefore = await page.evaluate(() => crossOriginIsolated);
    await page.evaluate(() => rigidDnaOpen(2));
    await page.waitForSelector("#rd2Engine a", { timeout: 30000 });
    await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 60000 }), page.click("#rd2Engine a")]);
    await page.waitForFunction(() => typeof rigidDnaOpen === "function", null, { timeout: 60000 });
    rec.isolatedAfter = await page.evaluate(() => crossOriginIsolated);
  }

  if (o.drop) {   // the drop hook of handleFiles opens the window and hands it the design
    const text = fs.readFileSync(o.design, "utf8");
    await page.evaluate(({ name, text }) => handleFiles([new File([text], name)]), { name: path.basename(o.design), text });
  } else {
    await page.evaluate(() => rigidDnaOpen(2));
  }
  await page.waitForSelector("#rd2Input", { state: "attached", timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("rd2Engine").textContent.length > 5, null, { timeout: 30000 });
  rec.engineText = await page.textContent("#rd2Engine");
  await page.waitForTimeout(1500);
  rec.gpuText = await page.textContent("#rd2Gpu");
  if (o.drop) rec.droppedFileShown = await page.textContent("#rd2File"); else await page.setInputFiles("#rd2Input", o.design);
  await page.waitForFunction(() => !document.getElementById("rd2RunBtn").disabled, null, { timeout: 30000 });
  await page.evaluate(({ t, route, infer, linkers }) => {
    const th = document.getElementById("rd2Threads"); th.value = String(Math.min(t, parseInt(th.max) || 1));
    document.getElementById("rd2Route").value = route; document.getElementById("rd2Infer").value = infer; if (linkers) document.getElementById("rd2Linkers").value = linkers;
  }, { t: o.threads, route: o.route, infer: o.infer, linkers: o.linkers });
  rec.threadsUsed = await page.evaluate(() => parseInt(document.getElementById("rd2Threads").value));
  rec.crossOriginIsolated = await page.evaluate(() => crossOriginIsolated);

  // progress samples taken in the page
  await page.evaluate(() => { window.__rd2Samples = []; const bar = document.getElementById("rd2Bar"); const lab = document.getElementById("rd2Stage");
    window.__rd2Timer = setInterval(() => window.__rd2Samples.push([Math.round(performance.now()), +bar.value.toFixed(3), lab.textContent]), 1000); });
  const tClick = Date.now();
  await page.click("#rd2RunBtn");
  if (o.cancelAfter) {
    await page.waitForTimeout(o.cancelAfter);
    const tc = Date.now();
    await page.click("#rd2CancelBtn");
    await page.waitForFunction(() => document.getElementById("rd2Stage").textContent === "Cancelled.", null, { timeout: 30000 });
    rec.cancel = { afterMs: o.cancelAfter, stoppedInMs: Date.now() - tc, runButtonEnabledAgain: await page.evaluate(() => !document.getElementById("rd2RunBtn").disabled) };
    rec.samples = await page.evaluate(() => window.__rd2Samples);
    // a second run after the cancel must work: use a fresh worker
    await page.click("#rd2RunBtn");
    rec.rerunAfterCancel = true;
  }
  await page.waitForFunction(() => /^Done in/.test(document.getElementById("rd2Stage").textContent) || /^Failed/.test(document.getElementById("rd2Stage").textContent), null, { timeout: o.timeout, polling: 500 });
  rec.pageSeconds = (Date.now() - tClick) / 1000;
  rec.stageText = await page.textContent("#rd2Stage");
  rec.samples2 = await page.evaluate(() => { clearInterval(window.__rd2Timer); return window.__rd2Samples.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 12)) === 0); });
  rec.summaryText = (await page.textContent("#rd2Summary")).replace(/\s+/g, " ").trim();
  if (/^Failed/.test(rec.stageText)) throw new Error(rec.stageText + "\n" + (await page.textContent("#rd2Log")));
  rec.logTail = (await page.textContent("#rd2Log")).split("\n").slice(-12).join("\n");
  // the structure reaches the scene through handleFiles
  await page.waitForFunction(() => typeof systems !== "undefined" && systems.length > 0 && systems[systems.length - 1].getMonomers().length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => { const n = systems.reduce((a, s) => a + s.getMonomers().length, 0); const st = window.__ld || (window.__ld = { n: -1, k: 0 }); if (st.n === n) st.k++; else { st.n = n; st.k = 0; } return n > 0 && st.k >= 4; }, null, { timeout: 120000, polling: 500 });
  rec.monomersInScene = await page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0));
  rec.systemName = await page.evaluate(() => systems[systems.length - 1].systemName || null);
  await page.screenshot({ path: o.out + "_ui.png", timeout: 300000 });
  // fit the camera to the structure and close the window for a clean canvas picture
  await page.evaluate(() => {
    const w = document.getElementById("rigidDNAWindow"); if (w) Metro.window.toggle(w);
    try { space.grid(false); } catch (e) { /* no grid */ }
    try { setArrowsVisibility(false); } catch (e) { /* ok */ }
    try { if (typeof boxObj !== "undefined" && boxObj) boxObj.visible = false; } catch (e) { /* ok */ }
    controls.staticMoving = true; if ("enableDamping" in controls) controls.enableDamping = false;
    const pts = []; let cx = 0, cy = 0, cz = 0;
    for (const sys of systems) for (const m of sys.getMonomers()) { const p = m.getPos(); pts.push(p); cx += p.x; cy += p.y; cz += p.z; }
    const c = new THREE.Vector3(cx / pts.length, cy / pts.length, cz / pts.length);
    let r2 = 0; for (const p of pts) r2 = Math.max(r2, p.distanceToSquared(c));
    const radius = Math.sqrt(r2) || 10, vfov = (camera.fov || 45) * Math.PI / 180, aspect = window.innerWidth / window.innerHeight;
    const eff = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * aspect)), dist = (radius / Math.tan(eff / 2)) * 1.2;
    const dir = new THREE.Vector3(0.35, 1, 0.45).normalize();
    controls.target.copy(c); camera.position.copy(c).addScaledVector(dir, dist);
    camera.near = Math.max(dist / 1000, 0.1); camera.far = dist * 100 + radius * 10; camera.updateProjectionMatrix(); controls.update();
    api.setBackgroundColor("#ffffff"); renderer.setClearColor(new THREE.Color("#ffffff"), 1); render();
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => render());
  await page.waitForTimeout(500);
  await page.screenshot({ path: o.out + "_structure.png", timeout: 300000 });
  rec.pageErrors = errors.slice(0, 8);
  fs.writeFileSync(o.out + ".json", JSON.stringify(rec, null, 1));
  console.log(JSON.stringify(rec, null, 1));
} catch (e) {
  console.error("e2e FAILED: " + e.message);
  fs.writeFileSync(o.out + ".json", JSON.stringify(Object.assign(rec, { failed: e.message }), null, 1));
  code = 1;
} finally {
  await browser.close();
  srv.close();
}
process.exit(code);
