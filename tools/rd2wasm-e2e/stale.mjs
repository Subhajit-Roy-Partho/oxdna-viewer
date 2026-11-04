#!/usr/bin/env node
/**
 * stale.mjs — what a user sees when the engine is redeployed while the viewer is open or cached (GitHub Pages sends Cache-Control: max-age=600).
 *
 *   node stale.mjs --root <viewer dir> --old-wasm <dir with the old rd2_*.wasm> --new-wasm <dir with the new ones> --design <beachball.json> --out <prefix> [--threads N] [--port N]
 *
 * Serves --root with Pages-like headers (max-age=600) and COOP/COEP; /wasm/rigiddna2/rd2_*.wasm come from the "deployed" directory, which the test switches from old to new
 * (a deployment), and /wasm/rigiddna2/build.json is computed from the deployed files when the root has the page code that reads it. One persistent browser profile:
 *   1. open the page, run the design (old engine: the log has no 'ring orientation from the junctions' line)
 *   2. deploy the new wasm; press Run again in the SAME tab                 -> is the new engine used?
 *   3. open the page again in a NEW tab of the same profile (HTTP cache) and run -> is the new engine used?
 * The new engine is recognised by the log line 'ring orientation from the junctions'. Prints PASS/FAIL per step and the engine build row.
 * Exit code 1 when any step still ran the old engine.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const o = { port: 8971, threads: 4 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[i + 1];
o.port = +o.port; o.threads = +o.threads;
if (!o.root || !o.oldWasm || !o.newWasm || !o.design || !o.out) { console.error("usage: stale.mjs --root D --old-wasm D --new-wasm D --design F --out PREFIX [--threads N] [--port N]"); process.exit(2); }
const ROOT = path.resolve(o.root);
let deployed = path.resolve(o.oldWasm);
const hasBuildJson = fs.existsSync(path.join(ROOT, "dist/editing/rigiddna2_bridge.js")) && /build\.json/.test(fs.readFileSync(path.join(ROOT, "dist/editing/rigiddna2_bridge.js"), "utf8"));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const hdr = { "Cache-Control": "max-age=600", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless", "Cross-Origin-Resource-Policy": "cross-origin" };
  if (u === "/wasm/rigiddna2/build.json") {   // like the deployed site this is also served with max-age 600 server-side; the page asks for it with no-store
    const h = crypto.createHash("sha256");
    for (const f of ["rd2_mt.wasm", "rd2_st.wasm"]) h.update(fs.readFileSync(path.join(deployed, f)));
    res.writeHead(200, Object.assign({ "Content-Type": "application/json" }, hdr)); res.end(JSON.stringify({ build: h.digest("hex").slice(0, 12), engine: path.basename(path.dirname(path.dirname(deployed))) + " (test)" })); return;
  }
  let f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (/^\/wasm\/rigiddna2\/rd2_(mt|st)\.wasm$/.test(u)) f = path.join(deployed, path.basename(u));
  if (!f.startsWith(ROOT) && !f.startsWith(deployed)) { res.writeHead(404); res.end(); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, Object.assign({ "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }, hdr));
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(o.port, "127.0.0.1", r));
const req = createRequire(import.meta.url);
const pw = [process.env.PLAYWRIGHT_CORE, "/home/subho/Documents/Github/oxdna-viewer/tools/oxview-render/node_modules/playwright-core"].filter(Boolean).map((c) => { try { return req(c); } catch { return null; } }).find(Boolean);
const cache = path.join(os.homedir(), ".cache", "ms-playwright");
const chrome = process.env.CHROME_PATH || fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(cache, d, "chrome-linux64", "chrome")).find((e) => fs.existsSync(e));
const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "rd2stale-"));
const ctx = await pw.chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, viewport: { width: 1200, height: 900 },
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage"] });
const designText = fs.readFileSync(o.design, "utf8");
let failed = 0;
const NEW = /ring orientation from the junctions/;
async function openPage() {
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof rigidDnaOpen === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']"); await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(2)']").click());
  await page.waitForSelector("#rd2Input", { state: "attached", timeout: 30000 });
  await page.evaluate((t) => handleFiles([new File([t], "beachball.json")]), designText);
  await page.waitForFunction(() => document.getElementById("rd2File").textContent.includes("beachball"), null, { timeout: 30000 });
  await page.fill("#rd2Threads", String(o.threads));
  return page;
}
async function run(page) {
  await page.evaluate(() => { document.getElementById("rd2Log").textContent = ""; document.getElementById("rd2Stage").textContent = "Idle."; });
  await page.click("#rd2RunBtn");
  await page.waitForFunction(() => /Done in|Failed/.test(document.getElementById("rd2Stage").textContent), null, { timeout: 900000, polling: 1000 });
  const log = await page.textContent("#rd2Log");
  const summary = (await page.textContent("#rd2Summary")).replace(/\s+/g, " ");
  const build = (/engine build\s*(\S+)/.exec(summary) || [])[1] || "(no build row)";
  return { isNew: NEW.test(log), stage: (await page.textContent("#rd2Stage")), build, serverBuild: (/engine build on the server: (\S+)/.exec(log) || [])[1] || "-" };
}
const check = (name, ok, extra) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${extra}`); if (!ok) failed++; };
console.log(`root ${ROOT} (page code reads build.json: ${hasBuildJson})`);
try {
  const p1 = await openPage();
  let r = await run(p1);
  check("1. first visit, old engine deployed: old engine runs", !r.isNew, JSON.stringify(r));
  await p1.screenshot({ path: o.out + "_1.png" });
  deployed = path.resolve(o.newWasm);   // a deployment
  r = await run(p1);
  check("2. new engine deployed, same tab, Run pressed again: new engine runs", r.isNew, JSON.stringify(r));
  const p2 = await openPage();
  r = await run(p2);
  check("3. new engine deployed, page opened again in the same profile (HTTP cache): new engine runs", r.isNew, JSON.stringify(r));
  await p2.screenshot({ path: o.out + "_3.png" });
} catch (e) { console.error(e); failed++; }
await ctx.close(); srv.close(); fs.rmSync(profile, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
