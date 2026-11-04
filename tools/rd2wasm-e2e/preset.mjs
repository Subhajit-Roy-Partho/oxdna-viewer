#!/usr/bin/env node
/**
 * preset.mjs — checks the beachball example of the rigidDNA2 tab in headless Chromium: 'Load the design' fills the design slot (13,848 nt design, not run) and shows the
 * note; 'Open the reviewed structure' puts the bundled reviewed beachball (run 3262, 13,848 nt, Rg about 18.2 nm) into the scene as a system; the note says it is a
 * reviewed reference and not identical to the live engine.
 *
 *   node preset.mjs --out <prefix> [--port N]      writes <prefix>_tab1.png, <prefix>_tab2.png; exit code 1 on a failed check
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8943 };
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); }
if (!o.out) { console.error("usage: preset.mjs --out PREFIX [--port N]"); process.exit(2); }

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
if (!pw) { console.error("playwright-core not found"); process.exit(2); }
const cache = path.join(os.homedir(), ".cache", "ms-playwright");
const chrome = process.env.CHROME_PATH || fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  .map((d) => path.join(cache, d, "chrome-linux64", "chrome")).find((e) => fs.existsSync(e));
const browser = await pw.chromium.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage"] });

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(2)']").click());
  await page.waitForSelector("#rd2PresetDesign", { state: "visible", timeout: 30000 });
  check("the example buttons exist and the note is hidden", (await page.isVisible("#rd2PresetRef")) && !(await page.isVisible("#rd2PresetNote")));

  await page.click("#rd2PresetDesign");
  await page.waitForFunction(() => document.getElementById("rd2File").textContent.includes("beachball.json"), null, { timeout: 30000 });
  const file = await page.textContent("#rd2File");
  check("Load the design fills the design slot (about 733 kB) and enables Run", /beachball\.json \(7\d\d kB\)/.test(file) && !(await page.$eval("#rd2RunBtn", (b) => b.disabled)), file);
  const note = await page.textContent("#rd2PresetNote");
  check("the note says reviewed reference, compressed rings and not identical", /run 3262/.test(note) && /compressed/.test(note) && /not identical/.test(note) && /Rg about 22\.9/.test(note));
  check("nothing was run (no structure in the scene)", await page.evaluate(() => systems.length === 0));

  await page.click("#rd2PresetRef");
  await page.waitForFunction(() => typeof systems !== "undefined" && systems.length > 0 && systems[systems.length - 1].getMonomers().length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => { const n = systems.reduce((a, s) => a + s.getMonomers().length, 0); const st = window.__ld || (window.__ld = { n: -1, k: 0 }); if (st.n === n) st.k++; else { st.n = n; st.k = 0; } return n > 0 && st.k >= 4; }, null, { timeout: 120000, polling: 500 });
  const m = await page.evaluate(() => {
    const pts = []; for (const s of systems) for (const mo of s.getMonomers()) pts.push(mo.getPos());
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length, z: a.z + p.z / pts.length }), { x: 0, y: 0, z: 0 });
    const rg = Math.sqrt(pts.reduce((a, p) => a + (p.x - c.x) ** 2 + (p.y - c.y) ** 2 + (p.z - c.z) ** 2, 0) / pts.length);
    return { n: pts.length, rg, finite: pts.every((p) => isFinite(p.x) && isFinite(p.y) && isFinite(p.z)) };
  });
  const rgNm = m.rg * 0.8518;   // viewer units are oxDNA simple units
  check("Open the reviewed structure puts 13,848 nucleotides into the scene, all finite", m.n === 13848 && m.finite, JSON.stringify(m));
  check("its radius of gyration is the reviewed 18.2 nm (within 0.3)", Math.abs(rgNm - 18.2) < 0.3, rgNm.toFixed(2) + " nm");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: o.out + "_preset.png" });
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) { console.error(e); failed++; }
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
