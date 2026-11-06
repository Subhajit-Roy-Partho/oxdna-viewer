#!/usr/bin/env node
/**
 * seqpred.mjs — checks the "predict with seqpred" input of the rigidRNA tab in headless Chromium: the input shows its controls, the WebAssembly module (own worker, build id from
 * wasm/seqpred/build.json in the URLs) predicts a designed kissing-loop RNA, the dot-bracket field is filled with a crossing layer, the summary names the build, and the
 * predicted structure builds through the ordinary rigidRNA run and reaches the scene.
 *
 *   node seqpred.mjs --out <prefix> [--port N]    exit code 1 on a failed check
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8961 };
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); else if (argv[i] === "--pdb") o.pdb = argv[++i]; else if (argv[i] === "--design") o.design = argv[++i]; }
if (!o.out) { console.error("usage: seqpred.mjs --out PREFIX [--port N]"); process.exit(2); }

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
const pw = [process.env.PLAYWRIGHT_CORE, path.join(ROOT, "tools/oxview-render/node_modules/playwright-core")].filter(Boolean).map((c) => { try { return req(c); } catch { return null; } }).find(Boolean);
if (!pw) { console.error("playwright-core not found"); process.exit(2); }
const cache = path.join(os.homedir(), ".cache", "ms-playwright");
const chrome = process.env.CHROME_PATH || fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  .map((d) => path.join(cache, d, "chrome-linux64", "chrome")).find((e) => fs.existsSync(e));
const browser = await pw.chromium.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage"] });

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const SEQ = "GGCACGUGCUUUCCUUGCAAGUCAAGUGGCGAGACUUGCUUCGGAAAGCACGGAAACUUCUGAUACACGAACAGAAGCGCCGACUGUUCGUUGUAUCAGAUAAACAGCUGUACCACGACGCCAACGGCGCAGGCGUCGCUCGGUACAGCUGAGUUACGUGAACGCCACACACGUAAUACCA";   // designed RNA of validation/pk_int (design d3_dis_chain_naive_00, 181 nt, two designed 6-bp kissing helices 76-129 and 25-167); predictor v2 finds both
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [], urls = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (rq) => { if (/wasm\/seqpred\//.test(rq.url())) urls.push(rq.url()); });
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function" && typeof spPredict === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(3)']").click());
  await page.waitForSelector("#rrRunBtn", { state: "attached", timeout: 30000 });
  await page.waitForTimeout(800);
  const vis = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && e.style.display !== "none"; }, id);
  const setMode = (m) => page.evaluate((m) => { const s = document.getElementById("rrMode"); s.value = m; try { Metro.getPlugin(s, "select").val(m); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); rrModeChanged(); }, m);
  const nNt = () => page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0));
  await setMode("seqpred");
  check("seqpred input: sequence, dot-bracket and seqpred controls", (await vis("rrBlkSeq")) && (await vis("rrBlkDb")) && (await vis("rrBlkSeqpred")) && !(await vis("rrBlkPredict")) && !(await vis("rrBlkFile")));
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, SEQ);
  // building before predicting is refused with a hint
  const before = await page.evaluate(() => rrInput());
  check("building without a prediction is refused with a hint", !!before.error && /Predict structure/.test(before.error), before.error);
  const t0 = Date.now();
  await page.evaluate(() => { document.getElementById("spSalt").value = "0.25"; spPredict(); });
  await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 900000 });
  const stage = await page.textContent("#spStage");
  console.log("prediction", ((Date.now() - t0) / 1000).toFixed(1), "s:", stage);
  check("prediction finishes", /^Done/.test(stage), stage);
  const db = await page.evaluate(() => document.getElementById("rrDb").value);
  check("dot-bracket field is filled, same length, balanced", db.length === SEQ.length && /\(/.test(db), db);
  check("the structure has a crossing layer ([ ]) = the kissing helices", /\[/.test(db) && /\]/.test(db), db);
  const sum = await page.innerText("#spSummary");
  check("summary names ViennaRNA 2.7.2, the predictor and a build id", /ViennaRNA 2\.7\.2/.test(sum) && /predictor v2|pk-int-frozen-v2/.test(sum) && /build [0-9a-f]{12}/.test(sum), sum.replace(/\s+/g, " ").slice(0, 400));
  check("the module files were requested with ?v=<build id>", urls.some((u) => /seqpred_(st|mt)\.wasm\?v=[0-9a-f]{12}/.test(u)) && urls.some((u) => /seqpred_worker\.js\?v=[0-9a-f]{12}/.test(u)), urls.join(" ").slice(0, 300));
  await page.screenshot({ path: o.out + "_seqpred.png" });
  // the predicted structure builds
  const n0 = await nNt();
  await page.evaluate(() => rrRun());
  await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("rrStage").textContent), null, { timeout: 300000 });
  await page.waitForTimeout(1200);
  const st2 = await page.textContent("#rrStage"), sum2 = await page.innerText("#rrSummary");
  check("the predicted structure goes through the rigidRNA run", /^Done/.test(st2), st2);
  check(`${SEQ.length} nucleotides added to the scene`, (await nNt()) - n0 === SEQ.length, `${n0} -> ${await nNt()}`);
  check("run summary says the structure came from seqpred and names the build", /predicted with seqpred|structure predicted by seqpred/.test(sum2) && /build [0-9a-f]{12}/.test(sum2), sum2.replace(/\s+/g, " ").slice(0, 200));
  await page.screenshot({ path: o.out + "_built.png" });
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
