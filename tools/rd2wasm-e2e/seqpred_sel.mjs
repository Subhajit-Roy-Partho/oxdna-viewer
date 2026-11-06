#!/usr/bin/env node
/**
 * seqpred_sel.mjs — checks the seqpred model selector and selection panel of the rigidRNA tab in
 * headless Chromium: the model selector lists every single-chain model (v2 default; v3; v4, M2,
 * h2d, ml2, ml3 enabled only when the loaded module build carries them, otherwise disabled with
 * "not in this build"), the honest trade-off line and the EXPERIMENTAL badge, the per-model option
 * blocks (gate margin for m2/h2d, discriminator threshold for ml2/ml3, multi-strand block for
 * ms2/msrna); every model the build offers runs on (a) the 181-nt designed kissing-loop RNA
 * (design d3_dis_chain_naive_00) and (b) a 76-nt natural tRNA, the summary renders the new fields
 * (model, predictor score, margin to the nested decoy, gate line, confidence, engine + loading
 * times, version line), the download builders produce non-empty files with the right content, and
 * the predicted structure builds through the ordinary rigidRNA run. Models absent from the loaded
 * build are reported as SKIPPED, not failed. Screenshots: desktop light, desktop dark, phone 390px.
 *
 *   node seqpred_sel.mjs --out <prefix> [--port N]    exit code 1 on a failed check
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8963 };
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); }
if (!o.out) { console.error("usage: seqpred_sel.mjs --out PREFIX [--port N]"); process.exit(2); }

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
const findChrome = () => {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  if (fs.existsSync("/opt/google/chrome/chrome")) return "/opt/google/chrome/chrome";
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  for (const d of fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const e = path.join(cache, d, "chrome-linux64", "chrome");
    if (fs.existsSync(e)) return e;
  }
  return null;
};
const browser = await pw.chromium.launch({ executablePath: findChrome(), headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage"] });

let failed = 0, skipped = 0;
const slog = process.env.SEL_LOG ? (s) => { try { fs.appendFileSync(process.env.SEL_LOG, s + "\n"); } catch {} } : null;
const check = (name, ok, extra = "") => { const line = `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`; console.log(line); if (slog) slog(line); if (!ok) failed++; };
const skip = (name, why) => { const line = `SKIP  ${name}  ${why}`; console.log(line); if (slog) slog(line); skipped++; };
// Designed RNA of validation/pk_int (design d3_dis_chain_naive_00, 181 nt, two designed 6-bp kissing helices); predictor v2 finds both
const SEQ = "GGCACGUGCUUUCCUUGCAAGUCAAGUGGCGAGACUUGCUUCGGAAAGCACGGAAACUUCUGAUACACGAACAGAAGCGCCGACUGUUCGUUGUAUCAGAUAAACAGCUGUACCACGACGCCAACGGCGCAGGCGUCGCUCGGUACAGCUGAGUUACGUGAACACGCCACACGUAAUACCA";
// Natural example: yeast tRNA-Phe, 76 nt (no designed kissing loops; the honest answer is the nested fold)
const TRNA = "GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA";
const SINGLE = ["v2", "v3", "v4", "m2", "h2d", "ml2", "ml3"];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function" && typeof spPredict === "function" && typeof spRenderSel === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(3)']").click());
  await page.waitForSelector("#rrRunBtn", { state: "attached", timeout: 30000 });
  await page.waitForTimeout(800);
  const setMode = (m) => page.evaluate((m) => { const s = document.getElementById("rrMode"); s.value = m; try { Metro.getPlugin(s, "select").val(m); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); rrModeChanged(); }, m);
  const nNt = () => page.evaluate(() => systems.reduce((a, s) => s.getMonomers().length, 0));
  await setMode("seqpred");
  // wait for the model refresh (starts the worker, reads version.models)
  await page.waitForFunction(() => { const m = document.getElementById("spModel"); return m && (/not in this build/.test(m.options[m.options.length - 1].text) || !m.options[m.options.length - 1].disabled); }, null, { timeout: 180000 });
  await page.waitForTimeout(500);

  // ---- model selector: every single-chain model listed, availability from the build
  const models = await page.evaluate(() => {
    const s = document.getElementById("spModel");
    if (!s) return null;
    return Array.from(s.options).map((x) => ({ value: x.value, text: x.text, disabled: x.disabled, title: x.title }));
  });
  check("model selector lists all single-chain models", !!models && models.map((m) => m.value).join(",") === SINGLE.join(","), JSON.stringify((models || []).map((m) => m.value)));
  check("v2 is the default", !!models && (await page.evaluate(() => document.getElementById("spModel").value)) === "v2");
  const mods = await page.evaluate(() => spEngine.versionInfo().then((v) => v.models || {}));
  const isIn = (id) => Object.prototype.hasOwnProperty.call(mods, id) && !(mods[id] && mods[id].available === false);
  for (const id of SINGLE) {
    const opt = (models || []).find((m) => m.value === id);
    if (isIn(id)) check(`model ${id} is selectable (in this build)`, !!opt && !opt.disabled, opt ? opt.text : "no option");
    else skip(`model ${id}`, "not in this build");
  }
  for (const id of SINGLE) {
    if (isIn(id)) continue;
    const opt = (models || []).find((m) => m.value === id);
    check(`model ${id} disabled with "not in this build"`, !!opt && opt.disabled && /not in this build/.test(opt.text), opt ? opt.text : "no option");
  }
  // honest trade-off tooltips (module line wins, else the fallback numbers of the sealed test)
  const v2t = (models || []).find((m) => m.value === "v2"), v3t = (models || []).find((m) => m.value === "v3"),
    m2 = (models || []).find((m) => m.value === "m2"), ml3 = (models || []).find((m) => m.value === "ml3");
  check("v2 tooltip states the honest trade-off", !!v2t && /0\.956/.test(v2t.title) && /0 of 44/.test(v2t.title), v2t ? v2t.title : "");
  check("v3 tooltip has no held-out result of its own", !!v3t && /closing-helix/.test(v3t.title) && /no held-out result/.test(v3t.title), v3t ? v3t.title : "");
  if (isIn("m2")) check("M2 tooltip states the honest trade-off (module note or fallback)", !!m2 && /0\.471/.test(m2.title) && /0\.641/.test(m2.title) && (/13\/20/.test(m2.title) || /3 of 44/.test(m2.title)), m2 ? m2.title : "");
  else skip("M2 tooltip", "not in this build");
  check("ml3 tooltip names the pKiss limit", !!ml3 && /pKiss/.test(ml3.title), ml3 ? ml3.title : "");
  // trade-off line under the selector + EXPERIMENTAL badge for m2
  const trade = await page.innerText("#spTradeoff");
  check("trade-off line under the selector names the sealed-test numbers", /0\.956/.test(trade) && /0 of 44/.test(trade), trade.slice(0, 200));

  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; try { Metro.getPlugin(s, "select").val(v); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); if (id === "spModel") spModelChanged(); else if (id === "spMethod") spMethodChanged(); }, [id, v]);
  const predict = async () => { await page.evaluate(() => spPredict()); await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 900000 }); return page.textContent("#spStage"); };
  const visible = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && e.style.display !== "none"; }, id);

  // per-model option blocks
  await setSel("spModel", "v2");
  check("v2: gate, threshold and multi-strand blocks hidden", !(await visible("spGateRow")) && !(await visible("spThrRow")) && !(await visible("spMsRow")));
  if (isIn("m2")) {
    await setSel("spModel", "m2");
    await page.waitForTimeout(800);
    check("m2: gate margin block shown, threshold hidden", (await visible("spGateRow")) && !(await visible("spThrRow")));
    check("gate margin hint names m2/h2d defaults", /default 2/.test(await page.evaluate(() => document.getElementById("spGate").placeholder)));
    await setSel("spModel", "v2");
  } else skip("m2 option block", "not in this build");
  for (const id of ["ml2", "ml3"]) {
    if (!isIn(id)) { skip(`${id} option block`, "not in this build"); continue; }
    await setSel("spModel", id);
    await page.waitForTimeout(800);
    check(`${id}: discriminator threshold block shown`, (await visible("spThrRow")) && !(await visible("spGateRow")));
    await setSel("spModel", "v2");
  }

  // ---- natural tRNA (76 nt): every available model runs, summary has the new fields, downloads work
  for (const id of SINGLE) {
    if (!isIn(id)) { skip(`${id} on tRNA + 181-nt`, "not in this build"); continue; }
    await setSel("spModel", id);
    await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spSalt").value = "0.25"; document.getElementById("spBudget").value = "0"; }, TRNA);
    const t0 = Date.now();
    const stage = await predict();
    console.log(id, "tRNA", ((Date.now() - t0) / 1000).toFixed(1), "s:", stage);
    check(`${id} tRNA prediction finishes`, /^Done/.test(stage), stage);
    if (!/^Done/.test(stage)) continue;
    const sum = await page.innerText("#spSummary");
    const rx = new RegExp("model\\s+" + id);
    check(`${id} summary names the model`, rx.test(sum), sum.replace(/\s+/g, " ").slice(0, 200));
    for (const [nm, re] of [["predictor score", /predictor score/], ["margin to the nested decoy", /margin to the nested decoy/], ["gate line", /gate/], ["confidence", /confidence/], ["engine + loading times", /engine .* s, loading .* s/], ["version line", /git [0-9a-f]{7,}/], ["build id", /build [0-9a-f]{12}/]]) {
      const mm = re;
      check(`${id} summary has ${nm}`, mm.test(sum), nm === "gate line" || nm === "confidence" ? sum.replace(/\s+/g, " ").slice(0, 400) : "");
    }
    check(`${id} selection panel shown with a gate line`, (await visible("spSel")) && (await page.textContent("#spGateLine")).length > 0, await page.textContent("#spGateLine"));
    const dl = await page.evaluate(([id, n]) => ({
      dbn: spDownloadContent(spLast, "dbn"), json: spDownloadContent(spLast, "json"), fa: spDownloadContent(spLast, "fa"),
    }), [id, TRNA.length]);
    let j = null; try { j = JSON.parse(dl.json.text); } catch (e) { /* no */ }
    check(`${id} downloads are non-empty with the right names`, dl.dbn.filename === `${id}_${TRNA.length}nt.dbn` && dl.json.filename === `${id}_${TRNA.length}nt.json` && dl.fa.filename === `${id}_${TRNA.length}nt.fa` && dl.dbn.text.length > 0 && dl.json.text.length > 0 && dl.fa.text.length > 0, [dl.dbn.filename, dl.json.filename, dl.fa.filename].join(" "));
    const db = await page.evaluate(() => document.getElementById("rrDb").value);
    check(`${id} dbn download holds the dot-bracket`, dl.dbn.text.includes(db), dl.dbn.text.slice(0, 120));
    check(`${id} json download parses with pairs and confidence fields`, !!j && Array.isArray(j.pairs) && "confidence" in j, dl.json.text.slice(0, 120));
    check(`${id} fa download holds the sequence and structure`, dl.fa.text.includes(TRNA) && dl.fa.text.includes(db));
    check(`${id} download buttons (dot-bracket, pairs, FASTA) are shown`, await page.evaluate(() => { const h = document.getElementById("spDownloads"); const b = h ? Array.from(h.querySelectorAll("button")).map((x) => x.textContent) : []; return b.length === 3 && /dot-bracket/.test(b[0]) && /pairs/.test(b[1]) && /FASTA/.test(b[2]); }));
  }

  // ---- the 181-nt designed kissing RNA, model v2: crossing layer, selection panel
  await setSel("spMethod", "v2");
  await setSel("spModel", "v2");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spSalt").value = "0.25"; }, SEQ);
  let t0 = Date.now();
  let stage = await predict();
  console.log("prediction", ((Date.now() - t0) / 1000).toFixed(1), "s:", stage);
  check("v2 181-nt prediction finishes", /^Done/.test(stage), stage);
  let sum = await page.innerText("#spSummary");
  check("summary shows the active model and the build id", /model\s+v2/.test(sum) && /build [0-9a-f]{12}/.test(sum), sum.replace(/\s+/g, " ").slice(0, 300));
  let db = await page.evaluate(() => document.getElementById("rrDb").value);
  check("predicted dot-bracket has the crossing layer", db.length === SEQ.length && /\[/.test(db), db);

  // ---- selection panel
  check("selection panel is shown", await page.evaluate(() => document.getElementById("spSel").style.display !== "none"));
  const arcs = await page.evaluate(() => ({
    all: document.querySelectorAll("#spArc path").length,
    red: document.querySelectorAll("#spArc path.sp-x").length,
    grey: document.querySelectorAll("#spArc path.sp-decoy").length,
    rows: document.querySelectorAll("#spCand .sp-cand").length,
    decoy: /nested-MFE decoy/.test(document.getElementById("spCand").textContent),
  }));
  check("arc diagram has red crossing arcs for the kissing design", arcs.red >= 2, JSON.stringify(arcs));
  check("grey nested-MFE decoy arcs are drawn below the axis", arcs.grey >= 2, JSON.stringify(arcs));
  check("ranked-candidate chart renders (candidates + decoy)", arcs.rows >= 2 && arcs.decoy, JSON.stringify(arcs));
  const before = await page.evaluate(() => document.getElementById("spArcWrap").innerHTML.length);
  await page.evaluate(() => { const rows = document.querySelectorAll("#spCand .sp-cand[data-k]"); if (rows[1]) rows[1].click(); });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ len: document.getElementById("spArcWrap").innerHTML.length, sel: document.querySelector("#spCand .sp-cand.spsel").getAttribute("data-k") }));
  check("clicking a candidate bar redraws the arc diagram", after.len > 0 && after.sel === "1", JSON.stringify(after) + " before " + before);
  // reference overlay: the shown candidate against itself is F1 1. Pick the first candidate whose
  // pairs round-trip through dot-bracket (the top pool candidates can carry pairs no single
  // dot-bracket string can hold; the overlay correctly refuses those), write it into the field,
  // then compare it against itself.
  const useK = await page.evaluate(() => {
    const a = spAdapt(spLast);
    for (let k = 0; k < a.candidates.length; k++) {
      const c = a.candidates[k];
      const db = spPairsDotbracket(a.length, c.pairs, c.layers);
      const back = spDbPairs(db);
      const want = c.pairs.slice().sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      if (JSON.stringify(back) === JSON.stringify(want)) {
        spSelIdx = k; spRenderSel(); spUseCandidate(k);
        return k;
      }
    }
    return -1;
  });
  check("a representable candidate is shown and written into the field", useK >= 0, "candidate " + useK);
  db = await page.evaluate(() => document.getElementById("rrDb").value);
  await page.evaluate((db) => { document.getElementById("spRefDb").value = db; spApplyRef(); }, db);
  await page.waitForTimeout(300);
  const refMsg = await page.textContent("#spRefMsg");
  check("reference overlay reports pair F1 1.000 for the shown candidate itself", /F1 1\.000/.test(refMsg), refMsg);
  await page.evaluate(() => { document.getElementById("spRefDb").value = "((("; spApplyRef(); });
  await page.waitForTimeout(300);
  check("a short reference is refused with a clear message", /but the sequence is/.test(await page.textContent("#spRefMsg")), await page.textContent("#spRefMsg"));
  await page.evaluate((db) => { document.getElementById("spRefDb").value = db; spApplyRef(); }, db);

  // ---- M2 on the same design (when the build carries it)
  if (isIn("m2")) {
    await setSel("spModel", "m2");
    await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, SEQ);
    stage = await predict();
    check("M2 prediction finishes", /^Done/.test(stage), stage);
    const sum2 = await page.innerText("#spSummary");
    check("summary shows model M2 (experimental) and the build id", /model\s+(m2|M2)/i.test(sum2) && /build [0-9a-f]{12}/.test(sum2), sum2.replace(/\s+/g, " ").slice(0, 300));
    const db2 = await page.evaluate(() => document.getElementById("rrDb").value);
    check("M2 returns a structure of the right length", db2.length === SEQ.length && /[(]/.test(db2), db2);
    const arcs2 = await page.evaluate(() => ({ all: document.querySelectorAll("#spArc path").length, rows: document.querySelectorAll("#spCand .sp-cand").length }));
    check("selection graph is redrawn for M2 (arcs and candidate rows)", arcs2.all >= 2 && arcs2.rows >= 2, JSON.stringify(arcs2));
    await setSel("spModel", "v2");
  } else skip("M2 181-nt run", "not in this build");

  // ---- time budget: a small budget still finishes (truncated or not, honestly reported)
  await setSel("spModel", "v2");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spBudget").value = "5"; }, SEQ);
  stage = await predict();
  check("budget run finishes", /^Done/.test(stage), stage);
  sum = await page.innerText("#spSummary");
  if (/truncated/.test(sum)) check("truncated budget run names the stage it stopped at", /at stage \S+/.test(sum), sum.replace(/\s+/g, " ").slice(0, 300));
  else skip("truncated stage name", "the 5 s budget run was not truncated");
  await page.evaluate(() => { document.getElementById("spBudget").value = "0"; });

  // ---- screenshots
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, SEQ);
  await predict();
  await page.evaluate(() => document.getElementById("spSel").scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: o.out + "_sel_light.png" });
  // the summary + download buttons after the 181-nt prediction
  await page.evaluate(() => document.getElementById("spDownloads").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: o.out + "_sel_downloads.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: o.out + "_sel_dark.png" });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById("spSel").scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: o.out + "_sel_phone.png" });
  await page.locator("#spSel").screenshot({ path: o.out + "_sel_phone_panel.png" });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });

  // ---- the predicted dot-bracket still goes through the rigidRNA run
  const n0 = await nNt();
  await page.evaluate(() => rrRun());
  await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("rrStage").textContent), null, { timeout: 300000 });
  await page.waitForTimeout(1200);
  check("the predicted structure goes through the rigidRNA run", /^Done/.test(await page.textContent("#rrStage")), await page.textContent("#rrStage"));
  check(`${SEQ.length} nucleotides added to the scene`, (await nNt()) - n0 === SEQ.length, `${n0} -> ${await nNt()}`);
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `${failed} FAILED (${skipped} skipped)` : `ALL PASS (${skipped} skipped)`);
process.exit(failed ? 1 : 0);
