#!/usr/bin/env node
/**
 * seqpred_modes.mjs — checks the methods v3 and MS-RNA (several strands) of the "predict with seqpred" input of the rigidRNA tab in headless Chromium: the input shows its controls, the WebAssembly module (own worker, build id from
 * wasm/seqpred/build.json in the URLs) predicts a designed kissing-loop RNA, the dot-bracket field is filled with a crossing layer, the summary names the build, and the
 * predicted structure builds through the ordinary rigidRNA run and reaches the scene.
 *
 *   node seqpred_modes.mjs --out <prefix> [--port N]    exit code 1 on a failed check
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
const V3_SEQ = "GGUUUCUUAUGGGACUCCUGCAGGAACCUUGUACCUGCAGGCACUCCCAUAAGAAGCGCGCCUGAAGGUCCAAACAAGGAGGACCUUCAACUCCUGCGUUGAAAUCGCAACAACGCAGGUCGCGCUAUUAACCCAAUGCGAUAGGGUUAAAACC";            // closing-helix design e3_clp_pal_04 of lane PK-7 (154 nt); predictor v3 selects a closing-helix candidate here
const V3_PAIRS = [[0,153],[1,152],[2,151],[3,150],[4,53],[5,52],[6,51],[7,50],[8,49],[9,48],[10,47],[11,46],[12,45],[13,44],[16,40],[17,39],[18,38],[19,37],[20,36],[21,35],[22,34],[23,33],[26,78],[27,77],[28,76],[29,75],[30,74],[31,73],[54,125],[55,124],[56,123],[57,122],[58,121],[59,120],[62,88],[63,87],[64,86],[65,85],[66,84],[67,83],[68,82],[69,81],[70,80],[92,118],[93,117],[94,116],[95,115],[96,114],[97,113],[98,112],[99,111],[100,110],[103,141],[104,140],[105,139],[106,138],[107,137],[108,136],[127,149],[128,148],[129,147],[130,146],[131,145],[132,144],[133,143]];          // 0-based pairs of the Python reference (scripts/seqpred/pk_closing.py predict3, salt 0.25), also what the C++ build reproduces in the golden test
const MS_SEQ = "CUUCGAGAGUCACC&CCGACCCCCAGCCAGUCUCGAAGG&GUGACAUACAGAUCAACAGGGUCG";     // survey/blind entry 7Q7Z, three strands
const MS_PAIRS = [[0,36],[1,35],[2,34],[3,33],[4,32],[5,31],[6,30],[7,29],[8,42],[9,41],[10,40],[11,39],[12,38],[15,61],[16,60],[17,59],[18,58],[19,57],[20,56]];          // 0-based global pairs, primary state of validation/multistrand/ms2_rna.py
const MS_ALT_NAME = "kiss";
const MS_ALT_PAIRS = [[0,36],[1,35],[2,34],[3,33],[4,32],[5,31],[8,42],[9,41],[10,40],[11,39],[12,38],[16,30],[17,29],[18,28],[48,60],[49,59],[50,58],[51,57]];
const MS_PRIMARY = "default";

const DNA_SEQ = "GGGCAAAAGCCC&CCGGTTTTCCGG&ATATGCGCATAT";     // synthetic three-strand DNA case: domain pairing finds nothing, the MFE leftover stems are kept
const DNA_PAIRS = [[3,30],[4,29],[5,28],[6,20],[7,19],[8,18],[9,17],[10,16],[11,15]];          // 1-based global pairs of the Python reference (dna_predict.predict, 25 C)
const G4_SEQ = "AGGGTTAGGGTTAGGGTTAGGG";                       // human telomeric repeat
const G4_MOTIFS = [[[1,3],[7,9],[13,15],[19,21]]];                   // 0-based inclusive tract intervals of ssdna_predict.g4_scan
const G4_HYBRID = [];                   // 1-based pairs of ssdna_predict.hybrid

// pairs of a dot-bracket (() [] {} <>), '&' ignored, 0-based over the concatenation
const pairsOf = (db) => { const st = { "(": [], "[": [], "{": [], "<": [] }, close = { ")": "(", "]": "[", "}": "{", ">": "<" }, out = []; let k = 0;
  for (const c of db) { if (c === "&") continue; if (st[c]) st[c].push(k); else if (close[c]) out.push([st[close[c]].pop(), k]); k++; } return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function" && typeof spPredict === "function" && typeof spUseAlternative === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(3)']").click());
  await page.waitForSelector("#rrRunBtn", { state: "attached", timeout: 30000 });
  await page.waitForTimeout(800);
  const setMode = (m) => page.evaluate((m) => { const s = document.getElementById("rrMode"); s.value = m; try { Metro.getPlugin(s, "select").val(m); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); rrModeChanged(); }, m);
  const setMethod = (m) => page.evaluate((m) => { const s = document.getElementById("spMethod"); s.value = m; try { Metro.getPlugin(s, "select").val(m); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); }, m);
  const nNt = () => page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0));
  const predict = async () => { await page.evaluate(() => spPredict()); await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 900000 }); return page.textContent("#spStage"); };
  await setMode("seqpred");
  const methods = await page.evaluate(() => Array.from(document.getElementById("spMethod").options).map((x) => x.value));
  check("the method list offers v3 and msrna", methods.includes("v3") && methods.includes("msrna"), methods.join(","));

  // ---- v3
  await setMethod("v3");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spSalt").value = "0.25"; }, V3_SEQ);
  let t0 = Date.now();
  let stage = await predict();
  console.log("v3", ((Date.now() - t0) / 1000).toFixed(1), "s:", stage);
  check("v3 prediction finishes", /^Done/.test(stage), stage);
  let db = await page.evaluate(() => document.getElementById("rrDb").value);
  check("v3 structure equals the Python reference (pk_closing.predict3)", same(pairsOf(db), V3_PAIRS), db);
  let sum = await page.innerText("#spSummary");
  check("v3 summary names the method and the caveat", /v3/.test(sum) && /frozen without a held-out result/.test(sum) && /build [0-9a-f]{12}/.test(sum), sum.replace(/\s+/g, " ").slice(0, 300));

  // ---- MS-RNA
  await setMethod("msrna");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, MS_SEQ);
  t0 = Date.now();
  stage = await predict();
  console.log("msrna", ((Date.now() - t0) / 1000).toFixed(1), "s:", stage);
  check("MS-RNA prediction finishes", /^Done/.test(stage), stage);
  db = await page.evaluate(() => document.getElementById("rrDb").value);
  check("dot-bracket has '&' between the three strands", (db.match(/&/g) || []).length === 2 && db.replace(/&/g, "").length === MS_SEQ.replace(/&/g, "").length, db);
  check("primary structure equals the Python reference (ms2_rna.predict)", same(pairsOf(db), MS_PAIRS), db);
  sum = await page.innerText("#spSummary");
  check("summary lists the primary state, the alternative state and the caveat", new RegExp("primary state\\s+" + MS_PRIMARY).test(sum) && sum.includes(MS_ALT_NAME) && /set of states/.test(sum), sum.replace(/\s+/g, " ").slice(0, 400));
  await page.screenshot({ path: o.out + "_msrna.png" });
  // the primary structure builds through the ordinary rigidRNA run (two '&')
  const n0 = await nNt();
  await page.evaluate(() => rrRun());
  await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("rrStage").textContent), null, { timeout: 300000 });
  await page.waitForTimeout(1000);
  const st2 = await page.textContent("#rrStage");
  check("the multi-strand structure goes through the rigidRNA run", /^Done/.test(st2), st2);
  check("all nucleotides of the three strands are added to the scene", (await nNt()) - n0 === MS_SEQ.replace(/&/g, "").length, `${n0} -> ${await nNt()}`);
  // the alternative state replaces the dot-bracket
  await page.evaluate(() => spUseAlternative(0));
  db = await page.evaluate(() => document.getElementById("rrDb").value);
  check("'use this structure' loads the alternative state (equals the reference state " + MS_ALT_NAME + ")", same(pairsOf(db), MS_ALT_PAIRS), db);
  // ---- DNA hybrid and single-stranded DNA tools (prediction only)
  await setMethod("dna");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, DNA_SEQ);
  stage = await predict();
  check("DNA hybrid finishes", /^Done/.test(stage), stage);
  db = await page.evaluate(() => document.getElementById("rrDb").value);
  check("DNA hybrid pairs equal the Python reference (dna_predict.predict)", same(pairsOf(db).map(([a, b]) => [a + 1, b + 1]), DNA_PAIRS), db);
  sum = await page.innerText("#spSummary");
  check("DNA summary names the hybrid, the MFE pairs added and the caveat", /DNA hybrid/.test(sum) && /pairs added from the MFE/.test(sum) && /no NUPACK/.test(sum), sum.replace(/\s+/g, " ").slice(0, 300));
  const refused = await page.evaluate(() => rrInput());
  check("the RNA engine refuses to build a DNA prediction", !!refused.error && /DNA prediction/.test(refused.error), refused.error);
  await setMethod("ssdna");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, G4_SEQ);
  stage = await predict();
  check("single-stranded DNA tools finish", /^Done/.test(stage), stage);
  sum = await page.innerText("#spSummary");
  const tracts = G4_MOTIFS.map((m) => m.map((t) => `${t[0] + 1}-${t[1] + 1}`).join(" / ")).join("; ");
  check("the G-quadruplex rule names the four G tracts of the reference", sum.includes(tracts), tracts);
  db = await page.evaluate(() => document.getElementById("rrDb").value);
  check("ssDNA hybrid pairs equal the Python reference (ssdna_predict.hybrid)", same(pairsOf(db).map(([a, b]) => [a + 1, b + 1]), G4_HYBRID), db);
  // a single-strand method refuses '&'
  await setMethod("v2");
  await page.evaluate(() => { document.getElementById("rrSeq").value = "GGGGAAAACCCC&GGGG"; document.getElementById("spStage").textContent = ""; });
  await page.evaluate(() => spPredict());
  await page.waitForTimeout(800);
  const stage3 = await page.textContent("#spStage"), running = await page.evaluate(() => document.getElementById("spCancelBtn").disabled === false);
  check("a single-strand method does not run on '&' input (no run started, the input is refused)", stage3 === "" && !running, JSON.stringify(stage3));
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
