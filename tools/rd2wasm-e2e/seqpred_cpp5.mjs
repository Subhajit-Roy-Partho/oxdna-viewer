#!/usr/bin/env node
/**
 * seqpred_cpp5.mjs: checks lane CPP-5 in the "predict with seqpred" input of the rigidRNA tab in headless Chromium: the `auto` router (C++ port of scripts/seqpred/auto_route.py, ML3 unavailable in the
 * browser): offered, enabled and the default of the method selector, honest label with the ML3 caveat, the arm / reason / mlFallback rows of the summary, and the pair sets of the Python router run with
 * ML3 disabled (golden values from scripts/seqpred/auto_route.py with auto_route.find_pkiss patched to "not found") for a natural pseudoknot RNA (NAT-1), several DNA strands (MS-3), several RNA strands
 * (MS-2) and a 9-nt strand (nested MFE); screenshots at desktop and phone width.
 *
 *   node seqpred_cpp5.mjs --out <prefix> [--port N]    exit code 1 on a failed check
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8964 };
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); else if (argv[i] === "--pdb") o.pdb = argv[++i]; else if (argv[i] === "--design") o.design = argv[++i]; }
if (!o.out) { console.error("usage: seqpred_cpp5.mjs --out PREFIX [--port N]"); process.exit(2); }

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
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function" && typeof spPredict === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(3)']").click());
  await page.waitForSelector("#rrRunBtn", { state: "attached", timeout: 30000 });
  await page.waitForTimeout(800);
  const setMode = (m) => page.evaluate((m) => { const s = document.getElementById("rrMode"); s.value = m; try { Metro.getPlugin(s, "select").val(m); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); rrModeChanged(); }, m);
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; try { Metro.getPlugin(s, "select").val(v); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);
  const predict = async () => { await page.evaluate(() => spPredict()); await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 900000 }); return page.textContent("#spStage"); };
  await setMode("seqpred");
  await page.evaluate(() => spMethodChanged());
  await page.waitForFunction(() => { const x = Array.from(document.getElementById("spMethod").options).find((y) => y.value === "auto"); return !!x && !x.disabled; }, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const opts = await page.evaluate(() => Object.fromEntries(Array.from(document.getElementById("spMethod").options).map((x) => [x.value, { disabled: x.disabled, text: x.text }])));
  check("method auto is offered and enabled", !!opts.auto && !opts.auto.disabled && !/PLACEHOLDER|not in this build/.test(opts.auto.text), JSON.stringify(opts.auto));
  check("auto is labelled as recommended", /recommended/i.test(opts.auto.text) || /router/i.test(opts.auto.text), opts.auto.text);
  const first = await page.evaluate(() => document.getElementById("spMethod").options[0].value);
  check("auto is the first entry of the method selector", first === "auto", first);
  const cur = await page.evaluate(() => document.getElementById("spMethod").value);
  check("auto is the default selection", cur === "auto", cur);
  check("ml3 stays disabled in the browser build (needs pKiss: native only)", !!opts.ml3 && opts.ml3.disabled, JSON.stringify(opts.ml3));
  for (const id of ["v2", "v3", "v4", "m2", "h2d", "ml2", "nat1", "e1", "ml4", "ms2", "ms3", "domainB", "hybridB"]) check(`existing method ${id} is still offered`, !!opts[id] && !opts[id].disabled, JSON.stringify(opts[id]));
  await setSel("spMethod", "auto");
  await page.evaluate(() => spMethodChanged());
  await page.waitForTimeout(600);
  const trade = await page.innerText("#spTradeoff");
  const tradeHtml = await page.innerHTML("#spTradeoff");
  check("auto line: ML3 needs pKiss and is not in the browser, NAT-1 / nested answer instead, says so in the result", /ML3/.test(trade) && /pKiss/.test(trade) && /NAT-1/.test(trade) && /nested/i.test(trade), trade.slice(0, 260));
  check("auto is not badged as missing", !/sp-missing/.test(tradeHtml));
  check("molecule / temperature options shown for auto, the ms2-only switches hidden", (await page.evaluate(() => document.getElementById("spMsRow").style.display !== "none")) && (await page.evaluate(() => document.getElementById("spMs2Only").style.display === "none")));
  const cases = [
    ["natural pseudoknot RNA 2K96 (47 nt)", "GGGCUGUUUUUCUCGCUGACUUUCAGCCCCAAACAAAAAAGUCAGCA", "NAT1", [[0,28],[1,27],[2,26],[3,25],[4,24],[5,23],[14,45],[15,44],[16,43],[17,42],[18,41],[19,40],[20,39],[21,38],[22,37]], true, "unknown"],
    ["three DNA strands", "GGGCAAAAGCCC&CCGGTTTTCCGG&ATATGCGCATAT", "MS3", [[2,29],[3,28],[4,27],[5,19],[6,18],[7,17],[8,16],[9,15],[10,14]], false, "medium"],
    ["two RNA strands", "GGGAAACCCUUUGGGAAAG&CCCAAAGGGUUUCCCAAAGC", "MS2", [[0,33],[1,32],[2,31],[3,30],[4,29],[5,28],[6,27],[7,26],[8,25],[9,24],[10,23],[11,22],[12,21],[13,20],[14,19]], false, "medium"],
    ["9-nt strand", "GGGAAACCC", "NESTED", [[0,8],[1,7],[2,6]], false, "low"],
  ];
  let shot = false;
  for (const [name, seq, arm, want, ml, level] of cases) {
    await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spSalt").value = "0.25"; }, seq);
    const t0 = Date.now();
    const stage = await predict();
    console.log(name, ((Date.now() - t0) / 1000).toFixed(1), "s:", stage);
    check(`${name}: auto prediction finishes`, /^Done/.test(stage), stage);
    const db = await page.evaluate(() => document.getElementById("rrDb").value);
    check(`${name}: structure equals the Python router (ML3 disabled)`, same(pairsOf(db), want), db);
    const sum = (await page.innerText("#spSummary")).replace(/\s+/g, " ");
    check(`${name}: summary says answered by ${arm}, gives reason, class and router confidence ${level}`, new RegExp("answered by " + arm).test(sum) && /reason:/.test(sum) && /router confidence\s+/.test(sum) && new RegExp("router confidence\\s+" + level).test(sum), sum.slice(0, 380));
    check(`${name}: mlFallback row ${ml ? "present" : "absent"}`, ml ? /mlFallback: true/.test(sum) && /pKiss/.test(sum) : !/mlFallback: true/.test(sum));
    check(`${name}: arms tried listed${ml ? " (ML3 unavailable)" : ""}`, /arms tried/.test(sum) && (!ml || /ML3: unavailable/.test(sum)), sum.slice(0, 500));
    if (ml) check(`${name}: the arm's own summary follows (gate / confidence rows of NAT-1)`, /gate \(logistic\)/.test(sum) && /not a measurement/.test(sum));
    if (!shot) {
      shot = true;
      await page.evaluate(() => { const e = document.getElementById("spSummary"); if (e) e.scrollIntoView(); });
      await page.screenshot({ path: o.out + "_auto_desktop.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      // the rigidDNA window is a fixed-width floating window (pre-existing): move it to the left edge and give it the phone width, as seqpred_cpp4.mjs does
      await page.evaluate(() => { const w = document.getElementById("rrBlkSeqpred").closest(".window"); if (w) { w.style.left = "0px"; w.style.top = "0px"; w.style.width = "390px"; w.style.maxWidth = "390px"; } document.getElementById("rrBlkSeqpred").scrollIntoView(); });
      await page.waitForTimeout(500);
      await page.evaluate(() => { const e = document.getElementById("spMethod"); if (e) e.scrollIntoView(); });
      await page.screenshot({ path: o.out + "_auto_phone_selector.png" });
      await page.evaluate(() => { const e = document.getElementById("spSummary"); if (e) e.scrollIntoView(); });
      await page.screenshot({ path: o.out + "_auto_phone_summary.png" });
      await page.setViewportSize({ width: 1280, height: 1000 });
    }
  }
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  console.log("FAIL  exception: " + (e && e.stack || e));
  failed++;
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `FAILED: ${failed} check(s)` : `ALL PASS (${skipped} skipped)`);
process.exit(failed ? 1 : 0);
