#!/usr/bin/env node
/**
 * ball.mjs — runs one design in the real rigidDNA2 window, with advanced fields typed in as a user does, and saves the result.
 *
 *   node ball.mjs --design <file> --out <prefix> [--set id=value ...] [--threads N] [--port N] [--timeout MS]
 *
 * --set rd2a_orientSearch=400 types 400 into that field (the group is opened first); a value of a select (rd2a_dist=1) is chosen from the list.
 * Writes <prefix>.top, <prefix>.dat (the structure the page received from the worker), <prefix>_ui.png (window), <prefix>_structure.png (canvas fitted to
 * the structure), <prefix>.json (command line preview, arguments received by the engine, summary, log tail, wall time).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const o = { port: 8961, threads: 4, timeout: 1200000, set: [] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--design") o.design = argv[++i]; else if (a === "--out") o.out = argv[++i]; else if (a === "--port") o.port = parseInt(argv[++i], 10);
  else if (a === "--threads") o.threads = parseInt(argv[++i], 10); else if (a === "--timeout") o.timeout = parseInt(argv[++i], 10);
  else if (a === "--set") o.set.push(argv[++i]); else { console.error("unknown option " + a); process.exit(2); }
}
if (!o.design || !o.out) { console.error("usage: ball.mjs --design FILE --out PREFIX [--set id=value ...]"); process.exit(2); }
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless", "Cross-Origin-Resource-Policy": "cross-origin" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(o.port, "127.0.0.1", r));
const req = createRequire(import.meta.url);
const pw = [process.env.PLAYWRIGHT_CORE, path.join(ROOT, "tools/oxview-render/node_modules/playwright-core"),
  "/home/subho/Documents/Github/oxdna-viewer/tools/oxview-render/node_modules/playwright-core"].filter(Boolean).map((c) => { try { return req(c); } catch { return null; } }).find(Boolean);
const cache = path.join(os.homedir(), ".cache", "ms-playwright");
const chrome = process.env.CHROME_PATH || fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  .map((d) => path.join(cache, d, "chrome-linux64", "chrome")).find((e) => fs.existsSync(e));
const browser = await pw.chromium.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage"] });
const rec = { set: o.set };
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text() + (m.location() && m.location().url ? " " + m.location().url : "")); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  page.on("worker", async (w) => {
    if (!/rd2_worker\.js/.test(w.url())) return;
    for (let k = 0; k < 50; k++) {
      try {
        await w.evaluate(() => { if (self.__p) return; self.__p = true; let n = 0; const t = setInterval(() => { if (++n > 3000) clearInterval(t);
          if (self.Rd2Api && self.Rd2Api.run && !self.Rd2Api.__p) { self.Rd2Api.__p = true; clearInterval(t); const run = self.Rd2Api.run;
            self.Rd2Api.run = (M, i, op, h) => { if (!M.__p) { M.__p = true; const c = M.ccall.bind(M); M.ccall = (nm, r, ty, a) => { if (nm === "rd2w_run") self.postMessage({ type: "argv", argv: a[2] }); return c(nm, r, ty, a); }; } return run(M, i, op, h); }; } }, 5); });
        break;
      } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  });
  await page.addInitScript(() => {
    window.__argvs = []; window.__results = [];
    const mk = Worker;
    window.Worker = function (...a) { const w = new mk(...a); w.addEventListener("message", (ev) => { const d = ev.data; if (d && d.type === "argv") window.__argvs.push(d.argv); if (d && d.type === "result") window.__results.push({ top: d.top, dat: d.dat, rc: d.rc }); }); return w; };
    window.Worker.prototype = mk.prototype;
  });
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function", null, { timeout: 120000 });
  await page.evaluate(() => rigidDnaOpen(2));
  await page.waitForSelector("#rd2Input", { state: "attached", timeout: 30000 });
  await page.waitForFunction(() => !!window.Rd2Api && document.getElementById("rd2Cmd").textContent.startsWith("rd2_run"), null, { timeout: 30000 });
  await page.setInputFiles("#rd2Input", o.design);
  await page.waitForFunction(() => !document.getElementById("rd2RunBtn").disabled, null, { timeout: 30000 });
  rec.threads = await page.evaluate((t) => { const e = document.getElementById("rd2Threads"); e.value = String(Math.min(t, parseInt(e.max) || 1)); e.dispatchEvent(new Event("input", { bubbles: true })); return parseInt(e.value); }, o.threads);
  rec.crossOriginIsolated = await page.evaluate(() => crossOriginIsolated);
  const centerClick = async (sel) => { await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel); await page.click(sel, { timeout: 15000 }); };
  const ensureOpen = async (id) => {
    if (!(await page.evaluate(() => document.querySelector("#rd2AdvAcc > .frame").classList.contains("active")))) await centerClick("#rd2AdvAcc > .frame > .heading");
    const hd = await page.evaluateHandle((i) => { const f = document.getElementById(i).closest(".frame"); return f && !f.classList.contains("active") ? f.querySelector(":scope > .heading") : null; }, id);
    if (hd.asElement()) { await hd.asElement().evaluate((e) => e.scrollIntoView({ block: "center" })); await hd.asElement().click(); await page.waitForTimeout(350); }
  };
  for (const s of o.set) {
    const [id, v] = s.split("=");
    await ensureOpen(id);
    const tag = await page.evaluate((i) => document.getElementById(i).tagName, id);
    if (tag === "SELECT") {
      const wrap = await page.evaluateHandle((i) => document.getElementById(i).closest(".select"), id);
      await wrap.asElement().evaluate((e) => e.scrollIntoView({ block: "center" })); await wrap.asElement().click(); await page.waitForTimeout(200);
      const item = await page.evaluateHandle(({ i, v }) => Array.from(document.getElementById(i).closest(".select").querySelectorAll("li")).find((l) => (l.getAttribute("data-value") || "") === v || l.textContent.trim() === v) || null, { i: id, v });
      await item.asElement().click(); await page.waitForTimeout(200);
    } else if (await page.evaluate((i) => document.getElementById(i).type === "checkbox", id)) {
      await centerClick(`label.checkbox:has(#${id})`);
    } else { await page.fill("#" + id, v); }
  }
  rec.preview = await page.evaluate(() => document.getElementById("rd2Cmd").textContent);
  rec.previewArgs = await page.evaluate(() => document.getElementById("rd2Cmd").getAttribute("data-args"));
  rec.problems = await page.evaluate(() => document.getElementById("rd2AdvProblems").textContent);
  await page.evaluate(() => document.getElementById("rd2Cmd").scrollIntoView({ block: "center" }));
  await page.screenshot({ path: o.out + "_options.png" });
  const t0 = Date.now();
  await centerClick("#rd2RunBtn");
  await page.waitForFunction(() => /^Done in|^Failed|^Stopped/.test(document.getElementById("rd2Stage").textContent), null, { timeout: o.timeout, polling: 1000 });
  rec.seconds = (Date.now() - t0) / 1000;
  rec.stage = await page.textContent("#rd2Stage");
  rec.argvReceived = await page.evaluate(() => window.__argvs.slice(-1)[0] || null);
  rec.argvMatchesPreview = rec.argvReceived === rec.previewArgs;
  rec.summary = (await page.textContent("#rd2Summary")).replace(/\s+/g, " ").trim();
  rec.log = (await page.textContent("#rd2Log")).split("\n").filter((l) => !/^  orient start/.test(l)).slice(0, 60);
  const res = await page.evaluate(() => window.__results.slice(-1)[0]);
  if (res && res.top) { fs.writeFileSync(o.out + ".top", res.top); fs.writeFileSync(o.out + ".dat", res.dat); }
  await page.waitForFunction(() => typeof systems !== "undefined" && systems.length > 0 && systems[systems.length - 1].getMonomers().length > 0, null, { timeout: 300000 });
  await page.waitForFunction(() => { const n = systems.reduce((a, s) => a + s.getMonomers().length, 0); const st = window.__ld || (window.__ld = { n: -1, k: 0 }); if (st.n === n) st.k++; else { st.n = n; st.k = 0; } return n > 0 && st.k >= 4; }, null, { timeout: 300000, polling: 500 });
  await page.screenshot({ path: o.out + "_ui.png" });
  await page.evaluate(() => {
    const w = document.getElementById("rigidDNAWindow"); if (w) Metro.window.toggle(w);
    try { space.grid(false); } catch (e) {} try { setArrowsVisibility(false); } catch (e) {} try { if (typeof boxObj !== "undefined" && boxObj) boxObj.visible = false; } catch (e) {}
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
  await page.waitForTimeout(1500); await page.evaluate(() => render()); await page.waitForTimeout(500);
  await page.screenshot({ path: o.out + "_structure.png", timeout: 300000 });
  rec.pageErrors = errors.slice(0, 8);
} catch (e) { console.error("ball FAILED: " + e.stack); code = 1; rec.exception = String(e.stack || e); }
fs.writeFileSync(o.out + ".json", JSON.stringify(rec, null, 1));
console.log(JSON.stringify({ stage: rec.stage, seconds: rec.seconds, preview: rec.preview, match: rec.argvMatchesPreview, errors: rec.pageErrors }, null, 1));
await browser.close(); srv.close();
process.exit(code);
