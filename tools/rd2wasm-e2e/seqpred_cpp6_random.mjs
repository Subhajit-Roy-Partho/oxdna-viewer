#!/usr/bin/env node
/**
 * seqpred_cpp6_random.mjs: runs a list of cases (the seeded random sample of lane CPP-6) through the "predict with seqpred" input of the rigidRNA tab in headless Chromium (the real viewer page with
 * the real WebAssembly package) and writes one JSON line per (case, method): pairs (1-based, 5'->3' on the concatenation), arm / label / reason of the router, wall seconds, browser memory,
 * console / page errors. Comparison with the frozen Python is done by the lane's scripts (scripts/seqpred/golden/compare_*), not here: this script only drives the page.
 *
 *   node seqpred_cpp6_random.mjs --cases cases.json --out results.jsonl [--port N] [--live https://host/path/index.html] [--bld2 N] [--timeout S] [--only ID,ID] [--shots PREFIX]
 *
 * cases.json: [{ id, strands: [...], molecule: "RNA" | "DNA", methods: ["auto", "nested", ...] }]; methods are values of the method selector of the tab (auto, nested, centroid, mea, nat1, e1, ml4, ms3, domainB, hybridB, ...).
 * --bld2 N: for the first N single-strand RNA cases that predict with auto, also build the 3D structure with bld2 and record the nucleotides loaded into the scene.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8965, bld2: 0, timeout: 900 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--cases") o.cases = argv[++i]; else if (a === "--out") o.out = argv[++i]; else if (a === "--port") o.port = parseInt(argv[++i], 10);
  else if (a === "--live") o.live = argv[++i]; else if (a === "--bld2") o.bld2 = parseInt(argv[++i], 10); else if (a === "--timeout") o.timeout = parseFloat(argv[++i]);
  else if (a === "--only") o.only = argv[++i].split(","); else if (a === "--shots") o.shots = argv[++i];
}
if (!o.cases || !o.out) { console.error("usage: seqpred_cpp6_random.mjs --cases cases.json --out results.jsonl [--live URL] [--bld2 N] [--timeout S] [--only ID,ID] [--shots PREFIX]"); process.exit(2); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = o.live ? { close() {} } : http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless", "Cross-Origin-Resource-Policy": "cross-origin" });
  fs.createReadStream(f).pipe(res);
});
if (!o.live) await new Promise((r) => srv.listen(o.port, "127.0.0.1", r));

const req = createRequire(import.meta.url);
const pw = [process.env.PLAYWRIGHT_CORE, path.join(ROOT, "tools/oxview-render/node_modules/playwright-core")].filter(Boolean).map((c) => { try { return req(c); } catch { return null; } }).find(Boolean);
if (!pw) { console.error("playwright-core not found (set PLAYWRIGHT_CORE)"); process.exit(2); }
const cache = path.join(os.homedir(), ".cache", "ms-playwright");
const chrome = process.env.CHROME_PATH || (fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(cache, d, "chrome-linux64", "chrome")).find((e) => fs.existsSync(e)) : undefined);
const browser = await pw.chromium.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage", "--enable-precise-memory-info"] });

// resident memory (MB) of the browser's processes (renderer, GPU, utility; playwright starts them with its own throw-away profile directory)
const rssMB = () => {
  try {
    const out = execSync("ps -eo rss=,args= | grep playwright_chromiumdev_profile | grep -v grep", { encoding: "utf8" });
    return Math.round(out.split("\n").filter(Boolean).reduce((a, l) => a + parseInt(l.trim().split(/\s+/)[0], 10), 0) / 1024);
  } catch { return null; }
};

const cases = JSON.parse(fs.readFileSync(o.cases, "utf8")).filter((c) => !o.only || o.only.includes(c.id));
const outf = fs.openSync(o.out, "a");
const done = new Set(fs.readFileSync(o.out, "utf8").split("\n").filter(Boolean).map((l) => { try { const j = JSON.parse(l); return j.id + "|" + j.method; } catch { return ""; } }));
let errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text().slice(0, 300)); });
  const failedReq = [];
  page.on("requestfailed", (r) => failedReq.push(r.url()));
  page.on("response", (r) => { if (r.status() >= 400) failedReq.push(r.status() + " " + r.url()); });
  await page.goto(o.live || `http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function" && typeof spPredict === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(3)']").click());
  await page.waitForSelector("#rrRunBtn", { state: "attached", timeout: 30000 });
  await page.waitForTimeout(800);
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); if (!s) return; s.value = v; try { Metro.getPlugin(s, "select").val(v); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);
  await setSel("rrMode", "seqpred");
  await page.evaluate(() => { rrModeChanged(); spMethodChanged(); });
  await page.waitForFunction(() => { const x = Array.from(document.getElementById("spMethod").options).find((y) => y.value === "auto"); return !!x && !x.disabled; }, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => spEngine.versionInfo().then((v) => ({ seqpred: v.seqpred, git: v.git, buildId: v.buildId, models: Object.keys(v.models || {}) })));
  const meta = { id: "_page", method: "_info", url: o.live || "local", chrome: chrome || "playwright default", version: info, idleRssMB: rssMB() };
  fs.writeSync(outf, JSON.stringify(meta) + "\n");
  console.log("page loaded:", JSON.stringify(info));
  let nBld2 = 0, shot = false;
  for (const c of cases) {
    for (const method of c.methods) {
      if (done.has(c.id + "|" + method)) continue;
      const rec = { id: c.id, method, nt: c.strands.reduce((s, x) => s + x.length, 0), strands: c.strands.length, molecule: c.molecule };
      errors = [];
      try {
        await setSel("spMethod", method);
        await page.evaluate(() => spMethodChanged());
        await page.waitForTimeout(250);
        const ok = await page.evaluate((m) => { const x = Array.from(document.getElementById("spMethod").options).find((y) => y.value === m); return !!x && !x.disabled; }, method);
        if (!ok) { rec.status = "method-not-offered"; fs.writeSync(outf, JSON.stringify(rec) + "\n"); continue; }
        await page.evaluate(([s, mol]) => {
          document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spSalt").value = "0.25";
          const m = document.getElementById("spMolecule"); if (m) { m.value = mol; try { Metro.getPlugin(m, "select").val(mol); } catch (e) {} }
          const t = document.getElementById("spTemp"); if (t) t.value = "";
        }, [c.strands.join("&"), c.molecule]);
        const t0 = Date.now();
        await page.evaluate(() => spPredict());
        await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: o.timeout * 1000 });
        rec.wallSeconds = +((Date.now() - t0) / 1000).toFixed(2);
        rec.stage = (await page.textContent("#spStage")).slice(0, 300);
        const r = await page.evaluate(() => ({ ok: !!spLast, pairs: spLast ? spLast.pairs : null, dotbracket: spLast ? spLast.dotbracket : null, arm: spLast && spLast.arm, label: spLast && spLast.label, reason: spLast && spLast.reason, mlFallback: spLast && spLast.mlFallback,
          method: spLast && spLast.method, truncated: spLast && spLast.truncated, wasm: spLast && spLast.version && spLast.version.git, nStrands: spLast && spLast.nStrands, routerConfidence: spLast && spLast.routerConfidence && spLast.routerConfidence.level,
          jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
        Object.assign(rec, r);
        rec.status = /^Done/.test(rec.stage) ? "ok" : "failed";
        rec.rssMB = rssMB();
        if (rec.status === "ok" && method === "auto" && c.strands.length === 1 && c.molecule === "RNA" && nBld2 < o.bld2 && c.strands[0].length <= 300 && /^[ACGU]+$/.test(c.strands[0])) {
          nBld2++;
          const t1 = Date.now();
          await page.evaluate(() => spBuildBld2());
          await page.waitForFunction(() => /^(bld2 done|bld2 failed|Cancelled)/.test(document.getElementById("spBld2Msg").textContent), null, { timeout: 300000 });
          const msg = await page.textContent("#spBld2Msg");
          await page.waitForFunction(() => systems.reduce((x, y) => x + y.getMonomers().length, 0) > 0, null, { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(800);
          rec.bld2 = { msg: msg.slice(0, 200), seconds: +((Date.now() - t1) / 1000).toFixed(2), ntInScene: await page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0)), stems: await page.evaluate(() => spLastBld2 && spLastBld2.nStems), loops: await page.evaluate(() => spLastBld2 && spLastBld2.loops && spLastBld2.loops.length) };
          if (o.shots) { shot = true; await page.evaluate(() => { const w = document.getElementById("rrBlkSeqpred").closest(".window"); if (w) w.style.display = "none"; }); await page.waitForTimeout(600); await page.screenshot({ path: o.shots + "_bld2_" + c.id + ".png" }); await page.evaluate(() => { const w = document.getElementById("rrBlkSeqpred").closest(".window"); if (w) w.style.display = ""; }); }
          await page.evaluate(() => { if (typeof clearSystems === "function") try { clearSystems(); } catch (e) {} else if (typeof systems !== "undefined") { while (systems.length) { try { systems.pop(); } catch (e) { break; } } } });
        }
        if (o.shots && method === "auto" && !rec.shotDone && /^S4_|S2_01|S1_01/.test(c.id)) { await page.evaluate(() => { const e = document.getElementById("spSummary"); if (e) e.scrollIntoView(); }); await page.screenshot({ path: o.shots + "_" + c.id + "_" + method + ".png" }); }
      } catch (e) { rec.status = "error"; rec.error = String(e).slice(0, 300); }
      rec.errors = errors.slice(0, 5);
      fs.writeSync(outf, JSON.stringify(rec) + "\n");
      console.log(c.id, method, rec.status, rec.wallSeconds, "s", rec.arm || "", rec.errors.length ? "ERRORS " + rec.errors.join(" | ") : "");
    }
  }
  fs.writeSync(outf, JSON.stringify({ id: "_page", method: "_end", failedRequests: failedReq.slice(0, 20), endRssMB: rssMB() }) + "\n");
} finally { await browser.close(); srv.close(); }
