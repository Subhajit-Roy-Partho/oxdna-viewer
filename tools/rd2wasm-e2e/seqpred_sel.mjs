#!/usr/bin/env node
/**
 * seqpred_sel.mjs — checks GOAL 1 + GOAL 2 of the seqpred-ui lane in headless Chromium: the
 * rigidRNA tab's "predict with seqpred" input shows a model selector (v2 default, v3, M2 when the module build carries it), a 181-nt designed kissing-loop RNA (model v2) predicts a crossing
 * layer, the summary names the model and the build id, the selection panel draws an arc diagram
 * with red crossing arcs and a grey nested-MFE decoy, the ranked-candidate chart renders and a
 * click redraws the arcs, the reference overlay reports pair F1, and the predicted structure
 * builds through the ordinary rigidRNA run. Screenshots: desktop light, desktop dark, phone 390px.
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

let failed = 0;
const slog = process.env.SEL_LOG ? (s) => { try { fs.appendFileSync(process.env.SEL_LOG, s + "\n"); } catch {} } : null;
const check = (name, ok, extra = "") => { const line = `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`; console.log(line); if (slog) slog(line); if (!ok) failed++; };
// Designed RNA of validation/pk_int (design d3_dis_chain_naive_00, 181 nt, two designed 6-bp kissing helices); predictor v2 finds both
const SEQ = "GGCACGUGCUUUCCUUGCAAGUCAAGUGGCGAGACUUGCUUCGGAAAGCACGGAAACUUCUGAUACACGAACAGAAGCGCCGACUGUUCGUUGUAUCAGAUAAACAGCUGUACCACGACGCCAACGGCGCAGGCGUCGCUCGGUACAGCUGAGUUACGUGAACGCCACACACGUAAUACCA";
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
  const nNt = () => page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0));
  await setMode("seqpred");
  await page.waitForTimeout(1500);

  // ---- GOAL 1: model selector
  const models = await page.evaluate(() => {
    const s = document.getElementById("spModel");
    if (!s) return null;
    return Array.from(s.options).map((x) => ({ value: x.value, text: x.text, disabled: x.disabled, title: x.title }));
  });
  check("model selector exists with v2, v3, m2", !!models && models.map((m) => m.value).join(",") === "v2,v3,m2", JSON.stringify(models));
  check("v2 is the default", !!models && (await page.evaluate(() => document.getElementById("spModel").value)) === "v2");
  const m2 = (models || []).find((m) => m.value === "m2");
  check("M2 is enabled when the module build carries it (and still labelled experimental)", !!m2 && !m2.disabled && !/not in this build/.test(m2.text) && /experimental/.test(m2.text), m2 ? m2.text : "no m2 option");
  const v2t = (models || []).find((m) => m.value === "v2"), v3t = (models || []).find((m) => m.value === "v3");
  check("v2 tooltip states the honest trade-off", !!v2t && /0\.956/.test(v2t.title) && /adds no pseudoknot on natural RNAs/.test(v2t.title), v2t ? v2t.title : "");
  check("M2 tooltip states the honest trade-off", !!m2 && /0\.471/.test(m2.title) && /0\.641/.test(m2.title) && /13\/20/.test(m2.title) && /3\/20/.test(m2.title), m2 ? m2.title : "");
  check("v3 tooltip describes closing-helix candidates without overclaiming", !!v3t && /closing-helix/.test(v3t.title) && /v2 remains the validated predictor/.test(v3t.title), v3t ? v3t.title : "");

  // ---- predict the kissing design, model v2
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; try { Metro.getPlugin(s, "select").val(v); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); if (id === "spModel") spModelChanged(); else if (id === "spMethod") spMethodChanged(); }, [id, v]);
  await setSel("spMethod", "v2");
  await setSel("spModel", "v2");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spSalt").value = "0.25"; }, SEQ);
  const t0 = Date.now();
  await page.evaluate(() => spPredict());
  await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 900000 });
  const stage = await page.textContent("#spStage");
  console.log("prediction", ((Date.now() - t0) / 1000).toFixed(1), "s:", stage);
  check("prediction finishes", /^Done/.test(stage), stage);
  const sum = await page.innerText("#spSummary");
  check("summary shows the active model and the build id", /model\s+v2/.test(sum) && /build [0-9a-f]{12}/.test(sum), sum.replace(/\s+/g, " ").slice(0, 300));
  const db = await page.evaluate(() => document.getElementById("rrDb").value);
  check("predicted dot-bracket has the crossing layer", db.length === SEQ.length && /\[/.test(db), db);

  // ---- GOAL 2: selection panel
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
  // clicking a candidate bar redraws the arc diagram
  const before = await page.evaluate(() => document.getElementById("spArcWrap").innerHTML.length);
  await page.evaluate(() => { const rows = document.querySelectorAll("#spCand .sp-cand[data-k]"); if (rows[1]) rows[1].click(); });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ len: document.getElementById("spArcWrap").innerHTML.length, sel: document.querySelector("#spCand .sp-cand.spsel").getAttribute("data-k") }));
  check("clicking a candidate bar redraws the arc diagram", after.len > 0 && after.sel === "1", JSON.stringify(after) + " before " + before);
  // reference overlay: the prediction against itself is F1 1
  await page.evaluate((db) => { document.getElementById("spRefDb").value = db; spApplyRef(); }, db);
  await page.waitForTimeout(300);
  const refMsg = await page.textContent("#spRefMsg");
  check("reference overlay reports pair F1 1.000 for the prediction itself", /F1 1\.000/.test(refMsg), refMsg);
  await page.evaluate(() => { document.getElementById("spRefDb").value = "((("; spApplyRef(); });
  await page.waitForTimeout(300);
  check("a short reference is refused with a clear message", /but the sequence is/.test(await page.textContent("#spRefMsg")), await page.textContent("#spRefMsg"));
  await page.evaluate((db) => { document.getElementById("spRefDb").value = db; spApplyRef(); }, db);

  // ---- model M2 on the same design: the selector drives options.model, the summary names M2 and the gate, the selection graph is redrawn
  await setSel("spModel", "m2");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, SEQ);
  await page.evaluate(() => spPredict());
  await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 900000 });
  const stage2 = await page.textContent("#spStage");
  check("M2 prediction finishes", /^Done/.test(stage2), stage2);
  const sum2 = await page.innerText("#spSummary");
  check("summary shows model M2 (experimental) and the build id", /model\s+(m2|M2)/i.test(sum2) && /build [0-9a-f]{12}/.test(sum2), sum2.replace(/\s+/g, " ").slice(0, 300));
  const db2 = await page.evaluate(() => document.getElementById("rrDb").value);
  check("M2 returns a structure of the right length", db2.length === SEQ.length && /[(]/.test(db2), db2);
  const arcs2 = await page.evaluate(() => ({ all: document.querySelectorAll("#spArc path").length, rows: document.querySelectorAll("#spCand .sp-cand").length }));
  check("selection graph is redrawn for M2 (arcs and candidate rows)", arcs2.all >= 2 && arcs2.rows >= 2, JSON.stringify(arcs2));
  await setSel("spModel", "v2");
  await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, SEQ);
  await page.evaluate(() => spPredict());
  await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 900000 });

  // ---- screenshots
  await page.evaluate(() => document.getElementById("spSel").scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: o.out + "_sel_light.png" });
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
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
