#!/usr/bin/env node
/**
 * seqpred_renderer.mjs — RENDERER CHECK (not a model check): feeds hand-written result objects shaped
 * like the new-module contract (v4 confidence, ml3 discriminator gate, ms2 multi-strand result, a
 * truncated run, and a current-build v2 result without the new fields) to spSummaryHtml and
 * spDownloadContent in headless Chromium, and checks the summary renders the new fields and the
 * downloads have the right names and content. No WebAssembly prediction runs here.
 *
 *   node seqpred_renderer.mjs --out <prefix> [--port N]    exit code 1 on a failed check
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8965 };
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); }
if (!o.out) { console.error("usage: seqpred_renderer.mjs --out PREFIX [--port N]"); process.exit(2); }

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
const findChrome = () => {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  if (fs.existsSync("/opt/google/chrome/chrome")) return "/opt/google/chrome/chrome";
  for (const d of fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const e = path.join(cache, d, "chrome-linux64", "chrome");
    if (fs.existsSync(e)) return e;
  }
  return null;
};
const browser = await pw.chromium.launch({ executablePath: findChrome(), headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage"] });

let failed = 0, skipped = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const skip = (name, why) => { console.log(`SKIP  ${name}  ${why}`); skipped++; };

// Hand-written fixtures shaped like the new-module contract (values invented for the renderer only).
const V4 = {
  ok: true, sequence: "GGGCGCUGAAAGCGCCCAAAAGGGCGCUGAAAGCGCCC", length: 38, method: "v4", salt: 0.25,
  dotbracket: "(((((((...[[[[[[...)))))))...]]]]]]", pairs: [[1, 28], [2, 27], [11, 23], [12, 22]], layers: [0, 0, 1, 1],
  helices: [{ i: 11, j: 23, k: 2 }], energy: { nestedMfe: -9.1, nestedDotbracket: "(((((((..............)))))))........", score: -12.6 },
  confidence: { model: "v4", status: "designed-kissing", marginNested: 3.5, marginOther: null, nExtraHelices: 1, helices: [{ i: 11, j: 23, k: 2, rules: ["ga", "dis_or_casc"], lpc: null }] },
  selection: { model: "v4", scoreName: "v4 score (lower is better)", route: "v4 override", gate: { kind: "none", fired: false, reason: "v4 has no gate" }, candidates: [{ rank: 1, hostSource: "mfe", score: -12.6, helices: [], pairs: [[1, 28], [2, 27]], layers: [0, 0] }], nestedMfe: {} },
  notes: ["renderer fixture"], truncated: false, timings: { total: 1.2 },
  version: { seqpred: "0.2.0", predictor: "v4", viennarna: "2.7.2", git: "abcdef1234567890" },
  build: { build: "abc123def456", engine: "fixture" }, variant: "st", wallSeconds: 1.5, loadSeconds: 0.8,
};
const ML3 = {
  ok: true, sequence: "GGGCGCUGAAAGCGCCCAAAAGGGCGCUGAAAGCGCCC", length: 38, method: "ml3", salt: 0.25,
  dotbracket: "(((((((...[[[[[[...)))))))...]]]]]]", pairs: [[1, 28], [2, 27], [11, 23], [12, 22]], layers: [0, 0, 1, 1],
  helices: [{ i: 11, j: 23, k: 2 }], energy: { nestedMfe: -9.1, nestedDotbracket: "(((((((..............)))))))........", score: -12.6 },
  confidence: { model: "ml3", status: "extra-helices", marginNested: 1.1, nExtraHelices: 1, pCross: 0.83, helices: [{ i: 11, j: 23, k: 2, rules: [], lpc: null }] },
  selection: { model: "ml3", scoreName: "ml3 score (lower is better)", route: "ML3 crossing candidate (p >= thr)", gate: { kind: "discriminator", thr: 0.7, pCross: 0.83, stage1Nested: -100.2, stage1Crossing: -99.1, marginValue: 1.1, fired: true, reason: "p >= thr" }, candidates: [{ rank: 1, hostSource: "mfe", score: -12.6, helices: [], pairs: [[1, 28]], layers: [0] }], nestedMfe: {} },
  notes: [], truncated: false, timings: { total: 2.1 },
  version: { seqpred: "0.2.0", predictor: "ml3", viennarna: "2.7.2", git: "abcdef1234567890" },
  build: { build: "abc123def456", engine: "fixture" }, variant: "st", wallSeconds: 2.4, loadSeconds: 0.0,
};
const MS2 = {
  ok: true, sequence: "AAAACCCC&GGGGUUUU", length: 16, method: "ms2", salt: 0.25, molecule: "RNA", temp: 37, route: "co-fold + partition",
  dotbracket: "((((....))))&((((....))))", pairs: [[1, 12], [2, 11], [9, 16], [10, 15]], layers: [0, 0, 0, 0],
  helices: [], energy: { freeEnergy: -12.34 }, lengths: [8, 8], strands: ["AAAACCCC", "GGGGUUUU"],
  alternatives: [{ name: "alt1", F: -5.2, dotbracket: "........&........", pairs: [], layers: [] }],
  kissPrior: { fired: true, dF: -1.2, Lk: 6, Lintra: 10 },
  notes: [], truncated: false, timings: { total: 0.5 },
  version: { seqpred: "0.2.0", predictor: "ms2", viennarna: "2.7.2", git: "abcdef1234567890" },
  build: { build: "abc123def456", engine: "fixture" }, variant: "st", wallSeconds: 0.7, loadSeconds: 0.1,
};
const TRUNC = Object.assign({}, V4, { ok: true, method: "v2", truncated: true, timings: { total: 5.0, truncatedAt: "D_refine_iter1" }, confidence: null, selection: { model: "v2", scoreName: "v2 score (lower is better)", gate: { fired: false, reason: "no-gate" }, candidates: [] } });
const OLDV2 = Object.assign({}, V4, { ok: true, method: "v2", confidence: null, selection: { model: "v2", scoreName: "v2 score (lower is better)", gate: { enabled: false, fired: false, margin: null, marginValue: -6.18, reason: "no-gate", bestNested: 0, bestCrossing: 8 }, candidates: [{ rank: 1, hostSource: "mfe", score: -12.6, helices: [], pairs: [[1, 28]], layers: [0], label: "nested" }] } });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof spSummaryHtml === "function" && typeof spDownloadContent === "function", null, { timeout: 120000 });

  const html = (fx, model) => page.evaluate(([fx, model]) => { spLastModel = model; return spSummaryHtml(fx); }, [fx, model]);

  // ---- v4 fixture: confidence status, colour, rules, gate kind none, route-less margin
  let h = await html(V4, "v4");
  check("RENDERER CHECK v4: confidence status designed-kissing is green", /designed-kissing/.test(h) && /color:green/.test(h), h.slice(0, 200));
  check("RENDERER CHECK v4: margin to the nested decoy 3.50", /margin to the nested decoy/.test(h) && /3\.50/.test(h));
  check("RENDERER CHECK v4: per-helix rule list ga+dis_or_casc", /rules ga\+dis_or_casc/.test(h), h.slice(0, 600));
  check("RENDERER CHECK v4: gate kind none renders", /gate.*not fired.*v4 has no gate/.test(h));
  check("RENDERER CHECK v4: engine and loading times", /engine 1\.2 s, loading 0\.8 s/.test(h));
  check("RENDERER CHECK v4: version line names git short hash", /git abcdef123456/.test(h));

  // ---- ml3 fixture: discriminator gate with p vs thr, route, confidence pCross
  h = await html(ML3, "ml3");
  check("RENDERER CHECK ml3: gate discriminator p = 0.83 vs thr 0.70 fired", /gate \(discriminator\): p = 0\.83 vs thr 0\.70: fired/.test(h), h.slice(h.indexOf("gate"), h.indexOf("gate") + 160));
  check("RENDERER CHECK ml3: stage1 nested/crossing shown", /stage1 nested -100\.20, crossing -99\.10/.test(h));
  check("RENDERER CHECK ml3: confidence extra-helices blue with p", /extra-helices/.test(h) && /color:#2563eb/.test(h) && /p = 0\.83/.test(h));
  check("RENDERER CHECK ml3: helix with no design rule says so", /no design rule admits it/.test(h));

  // ---- ms2 fixture: strands, route, molecule, alternatives, kiss prior
  h = await html(MS2, null);
  check("RENDERER CHECK ms2: strands and molecule rows", /1: 8 nt.*2: 8 nt/.test(h) && /RNA/.test(h));
  check("RENDERER CHECK ms2: route row", /co-fold \+ partition/.test(h));
  check("RENDERER CHECK ms2: alternative state with use button", /alt1.*-5\.20 kcal\/mol.*use this structure/.test(h));
  check("RENDERER CHECK ms2: kissing prior fired", /kissing prior.*fired.*dF -1\.20/.test(h));

  // ---- truncated fixture: truncated row names the stage
  h = await html(TRUNC, "v2");
  check("RENDERER CHECK truncated: names the stage the budget stopped at", /truncated/.test(h) && /D_refine_iter1/.test(h), h.slice(h.indexOf("truncated") - 40, h.indexOf("truncated") + 120));

  // ---- current-build v2 shape: missing new fields degrade honestly, never throw
  h = await html(OLDV2, "v2");
  check("RENDERER CHECK old v2: confidence honestly not reported", /confidence: not reported by this build/.test(h));
  check("RENDERER CHECK old v2: old gate shape renders without kind", /gate: not fired \(no-gate\)/.test(h));
  check("RENDERER CHECK old v2: margin falls back to selection decoy", /margin to the nested decoy.*0\.00/.test(h) || /margin to the nested decoy/.test(h));

  // ---- downloads
  const dl = (fx, kind) => page.evaluate(([fx, kind]) => spDownloadContent(fx, kind), [fx, kind]);
  let d = await dl(V4, "dbn");
  check("RENDERER CHECK download dbn name and content", d.filename === "v4_38nt.dbn" && d.text.length > 0 && d.text.includes(V4.dotbracket), d.filename);
  d = await dl(V4, "json");
  let j = null; try { j = JSON.parse(d.text); } catch (e) { /* not json */ }
  check("RENDERER CHECK download json parses with pairs and confidence", d.filename === "v4_38nt.json" && !!j && j.pairs.length === 4 && j.confidence.status === "designed-kissing");
  d = await dl(V4, "fa");
  check("RENDERER CHECK download fa single record with dot-bracket", d.filename === "v4_38nt.fa" && />strand1 v4_38nt/.test(d.text) && d.text.includes(V4.dotbracket));
  d = await dl(MS2, "fa");
  check("RENDERER CHECK download ms2 fa one record per strand", d.filename === "ms2_16nt.fa" && (d.text.match(/>strand/g) || []).length === 2 && d.text.includes("AAAACCCC") && d.text.includes("GGGGUUUU"));
  d = await dl(MS2, "dbn");
  check("RENDERER CHECK download ms2 dbn keeps the & separator", d.text.includes("&"));

  check("RENDERER CHECK: no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `${failed} FAILED (${skipped} skipped)` : `ALL PASS (${skipped} skipped)`);
process.exit(failed ? 1 : 0);
