#!/usr/bin/env node
/**
 * seqpred_cpp4.mjs: checks the models added by lane CPP-4 in the "predict with seqpred" input of the rigidRNA tab in headless Chromium: NAT-1, ENERGY-1 (K 30 and K 50), ML-4, MS-3, domain pairing B,
 * hybrid B, the auto placeholder and the scoring of a prediction against a pasted reference (C++ metrics of the module).  Each model must be selectable and enabled (auto: disabled and labelled
 * PLACEHOLDER), run a small example, and give the pair set of the Python reference (golden values of scripts/seqpred/golden/golden_cpp4.py, native C++ equal to them); screenshots at desktop
 * and phone width.
 *
 *   node seqpred_cpp4.mjs --out <prefix> [--port N]    exit code 1 on a failed check
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

let failed = 0, skipped = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const skip = (name, why) => { console.log(`SKIP  ${name}  ${why}`); skipped++; };
const RNA_SEQ = "GGGCUGUUUUUCUCGCUGACUUUCAGCCCCAAACAAAAAAGUCAGCA";   // natural dev pseudoknot 2K96 (47 nt): the gate of NAT-1 / ENERGY-1 / ML-4 opens
const RNA_PAIRS = [[0,28],[1,27],[2,26],[3,25],[4,24],[5,23],[14,45],[15,44],[16,43],[17,42],[18,41],[19,40],[20,39],[21,38],[22,37]];   // 0-based, Python reference (predict_nat1 / predict_e1 K 30, K 50 / predict_ml4)
const DNA_SEQ = "GGGCAAAAGCCC&CCGGTTTTCCGG&ATATGCGCATAT";           // three DNA strands
const MS3_PAIRS = [[2,29],[3,28],[4,27],[5,19],[6,18],[7,17],[8,16],[9,15],[10,14]];   // predict_ms3 (route ms2:dna-hybrid); hybrid B equals it, domain pairing B finds nothing
const pairsOf = (db) => { const st = { "(": [], "[": [], "{": [], "<": [] }, close = { ")": "(", "]": "[", "}": "{", ">": "<" }, out = []; let k = 0;
  for (const c of db) { if (c === "&") continue; if (st[c]) st[c].push(k); else if (close[c]) out.push([st[close[c]].pop(), k]); k++; } return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function" && typeof spPredict === "function" && typeof spApplyRef === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(3)']").click());
  await page.waitForSelector("#rrRunBtn", { state: "attached", timeout: 30000 });
  await page.waitForTimeout(800);
  const setMode = (m) => page.evaluate((m) => { const s = document.getElementById("rrMode"); s.value = m; try { Metro.getPlugin(s, "select").val(m); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); rrModeChanged(); }, m);
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; try { Metro.getPlugin(s, "select").val(v); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);
  const predict = async () => { await page.evaluate(() => spPredict()); await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 900000 }); return page.textContent("#spStage"); };
  const visible = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && e.style.display !== "none"; }, id);
  await setMode("seqpred");
  await page.evaluate(() => spMethodChanged());
  // the model list is built from version.models of the loaded module: wait until the worker has loaded it
  await page.waitForFunction(() => { const x = Array.from(document.getElementById("spMethod").options).find((y) => y.value === "nat1"); return !!x && !x.disabled; }, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const opts = await page.evaluate(() => Object.fromEntries(Array.from(document.getElementById("spMethod").options).map((x) => [x.value, { disabled: x.disabled, text: x.text }])));
  for (const id of ["nat1", "e1", "ml4", "ms3", "domainB", "hybridB"]) check(`method ${id} is offered and enabled (in this build)`, !!opts[id] && !opts[id].disabled && !/not in this build/.test(opts[id].text), JSON.stringify(opts[id]));
  check("method auto (lane CPP-5: the ROUTE-1 router) is offered and enabled, no longer a placeholder", !!opts.auto && !opts.auto.disabled && !/PLACEHOLDER|not in this build/.test(opts.auto.text), JSON.stringify(opts.auto));
  check("ml3 stays disabled in the browser build (needs pKiss: native only)", !!opts.ml3 && opts.ml3.disabled, JSON.stringify(opts.ml3));
  const modelOpts = await page.evaluate(() => Object.fromEntries(Array.from(document.getElementById("spModel").options).map((x) => [x.value, { disabled: x.disabled, text: x.text }])));
  check("model selector offers nat1, e1, ml4 (enabled)", ["nat1", "e1", "ml4"].every((k) => modelOpts[k] && !modelOpts[k].disabled), JSON.stringify(modelOpts));
  // trade-off lines (honest labels)
  const trade = {};
  for (const id of ["nat1", "e1", "ml4", "ms3", "domainB", "hybridB", "auto"]) { await setSel("spMethod", id); await page.evaluate(() => spMethodChanged()); await page.waitForTimeout(600); trade[id] = await page.innerText("#spTradeoff"); }
  check("NAT-1 line: 12-250 nt, blind numbers, ML3 comparison, not a designed-RNA model", /12-250/.test(trade.nat1) && /24 of 228/.test(trade.nat1) && /ML3/.test(trade.nat1) && /Not a designed-RNA model|NOT a designed-RNA model/.test(trade.nat1), trade.nat1.slice(0, 200));
  check("ENERGY-1 line: not a more accurate energy", /NOT a more accurate energy/.test(trade.e1), trade.e1.slice(0, 160));
  check("ML-4 line: does not beat NAT-1", /does not beat NAT-1/i.test(trade.ml4), trade.ml4.slice(0, 160));
  check("MS-3 line: EXPERIMENTAL and design decoder not blind", /EXPERIMENTAL/.test(trade.ms3) && /DESIGN DECODER/.test(trade.ms3), trade.ms3.slice(0, 160));
  check("domain pairing / hybrid B lines: design decoder, not a blind folding model", /DESIGN DECODER/.test(trade.domainB) && /DESIGN DECODER/.test(trade.hybridB));
  check("auto line: the router, with the ML3 / pKiss caveat", /router/i.test(trade.auto) && /ML3/.test(trade.auto) && /pKiss/.test(trade.auto), trade.auto.slice(0, 200));
  const badge = await page.innerHTML("#spTradeoff");
  check("auto is not badged as missing", !/sp-missing|not in this build|PLACEHOLDER/.test(badge));
  // ---- single-chain price models
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spSalt").value = "0.25"; }, RNA_SEQ);
  for (const [id, k] of [["nat1", null], ["e1", "30"], ["e1", "50"], ["ml4", null]]) {
    await setSel("spMethod", id);
    await page.evaluate(() => spMethodChanged());
    await page.waitForTimeout(500);
    if (k) { check(`${id}: pre-filter K option shown`, await visible("spKRow")); await setSel("spK", k); }
    else check(`${id}: no K option`, !(await visible("spKRow")));
    const t0 = Date.now();
    const stage = await predict();
    console.log(id, k || "", ((Date.now() - t0) / 1000).toFixed(1), "s:", stage);
    check(`${id}${k ? " K=" + k : ""} prediction finishes`, /^Done/.test(stage), stage);
    const db = await page.evaluate(() => document.getElementById("rrDb").value);
    check(`${id}${k ? " K=" + k : ""} structure equals the Python reference`, same(pairsOf(db), RNA_PAIRS), db);
    const sum = (await page.innerText("#spSummary")).replace(/\s+/g, " ");
    check(`${id}${k ? " K=" + k : ""} summary: gate (logistic) line, confidence and the honest caveat`, /gate \(logistic\)/.test(sum) && /confidence/.test(sum) && /not a measurement/.test(sum) && /build [0-9a-f]{12}/.test(sum), sum.slice(0, 260));
    if (id === "e1") check("e1 summary names the pre-filter K", new RegExp(`K = ${k}`).test(sum), sum.slice(0, 200));
    if (id === "ml4") check("ml4 summary shows the ensemble margin", /HG-Net ensemble/.test(sum) && /5 seeds/.test(sum), sum.slice(0, 200));
    check(`${id} selection panel visible with the gate line`, (await visible("spSel")) && /logistic/.test(await page.innerText("#spGateLine")));
  }
  // ---- reference scoring (C++ metrics of the module): the prediction against itself, and against a pair-list reference with one pair removed
  const refDb = await page.evaluate(() => document.getElementById("rrDb").value);
  await page.evaluate((d) => { document.getElementById("spRefDb").value = d; }, refDb);
  await page.evaluate(() => spApplyRef());
  await page.waitForFunction(() => /F1/.test(document.getElementById("spRefMsg").textContent), null, { timeout: 30000 });
  let tab = (await page.innerText("#spRefScore")).replace(/\s+/g, " ");
  check("reference = prediction: F1 1.000 and pseudoknot found", /pair F1 1\.000/.test(await page.textContent("#spRefMsg")) && /pseudoknot found.*1/.test(tab), tab.slice(0, 260));
  const pl = RNA_PAIRS.slice(1).map((p) => `${p[0] + 1} ${p[1] + 1}`).join("\n");
  await page.evaluate((t) => { document.getElementById("spRefDb").value = t; }, pl);
  await page.evaluate(() => spApplyRef());
  await page.waitForFunction(() => /pairs reference/.test(document.getElementById("spRefMsg").textContent), null, { timeout: 30000 });
  const msg = await page.textContent("#spRefMsg");
  check("pair-list reference (one pair removed): recall 14/15 in the message", /14 pairs/.test(msg) && /1 only predicted/.test(msg), msg);
  await page.evaluate(() => { const e = document.getElementById("spRefScore"); if (e) e.scrollIntoView(); });
  await page.screenshot({ path: o.out + "_score.png" });
  await page.evaluate(() => { document.getElementById("spRefDb").value = ""; spApplyRef(); });
  // ---- multi-strand: MS-3, domain pairing B, hybrid B
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, DNA_SEQ);
  for (const [id, want] of [["ms3", MS3_PAIRS], ["domainB", []], ["hybridB", MS3_PAIRS]]) {
    await setSel("spMethod", id);
    await page.evaluate(() => spMethodChanged());
    await page.waitForTimeout(500);
    if (id === "ms3") check("ms3: molecule / temperature / dimer-table options shown, ms2-only switches hidden", (await visible("spMsRow")) && (await visible("spMs3Row")) && !(await visible("spMs2Only")));
    const stage = await predict();
    check(`${id} prediction finishes`, /^Done/.test(stage), stage);
    const db = await page.evaluate(() => document.getElementById("rrDb").value);
    check(`${id} structure equals the Python reference`, same(pairsOf(db), want), db);
    const sum = (await page.innerText("#spSummary")).replace(/\s+/g, " ");
    if (id === "ms3") check("ms3 summary: route, assembly (complexes, dimers) and the EXPERIMENTAL caveat", /route\s+ms2:dna-hybrid/.test(sum) && /assembly/.test(sum) && /dimers/.test(sum) && /EXPERIMENTAL/.test(sum), sum.slice(0, 400));
    else check(`${id} summary: design decoder caveat`, /DESIGN DECODER/.test(sum) && /not a blind folding model/.test(sum), sum.slice(0, 300));
  }
  // ---- screenshots at desktop and phone width
  await setSel("spMethod", "nat1");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; }, RNA_SEQ);
  await predict();
  await page.evaluate(() => document.getElementById("rrBlkSeqpred").scrollIntoView());
  await page.screenshot({ path: o.out + "_desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  // the rigidDNA window is a floating window of fixed width (pre-existing): move it to the left edge of the phone viewport and narrow it to the screen width
  await page.evaluate(() => { const w = document.getElementById("rrBlkSeqpred").closest(".window"); if (w) { w.style.left = "0px"; w.style.top = "0px"; w.style.width = "390px"; w.style.maxWidth = "390px"; } document.getElementById("rrBlkSeqpred").scrollIntoView(); });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => { const b = document.getElementById("rrBlkSeqpred"); return { scroll: b.scrollWidth, client: b.clientWidth }; });
  console.log("phone width: seqpred block scrollWidth", overflow.scroll, "clientWidth", overflow.client);
  await page.screenshot({ path: o.out + "_phone.png" });
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `FAILED: ${failed} check(s)` : `ALL PASS (${skipped} skipped)`);
process.exit(failed ? 1 : 0);
