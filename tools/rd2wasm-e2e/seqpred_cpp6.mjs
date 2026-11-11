#!/usr/bin/env node
/**
 * seqpred_cpp6.mjs: checks lane CPP-6 in the "predict with seqpred" input of the rigidRNA tab in headless Chromium: the baselines `centroid` and `mea` (offered, enabled, labelled as baselines, pair sets of the
 * frozen Python runall.models.run_centroid / run_MEA for a natural pseudoknot RNA and a DNA duplex), and the reference from oxDNA / oxRNA files (a topology + configuration chosen with the file input of the
 * reference box: pairs, scoring against the drawn candidate, sequence check, a wrong-size file refused).
 *
 *   node seqpred_cpp6.mjs --out <prefix> [--port N] [--live https://host/path/index.html]    exit code 1 on a failed check
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8966 };
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); else if (argv[i] === "--live") o.live = argv[++i]; else if (argv[i] === "--pdb") o.pdb = argv[++i]; else if (argv[i] === "--design") o.design = argv[++i]; }
if (!o.out) { console.error("usage: seqpred_cpp6.mjs --out PREFIX [--port N]"); process.exit(2); }

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
if (!pw) { console.error("playwright-core not found"); process.exit(2); }
const cache = path.join(os.homedir(), ".cache", "ms-playwright");
const chrome = process.env.CHROME_PATH || fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
  .map((d) => path.join(cache, d, "chrome-linux64", "chrome")).find((e) => fs.existsSync(e));
const browser = await pw.chromium.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--disable-dev-shm-usage"] });

let failed = 0, skipped = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const RNA_SEQ = "GGGCUGUUUUUCUCGCUGACUUUCAGCCCCAAACAAAAAAGUCAGCA";   // 2K96 (47 nt)
const PY = {   // runall.models.run_centroid / run_MEA (frozen Python, ViennaRNA 2.7.2), 1-based pairs
  centroid: { rna: [[15,46],[16,45],[17,44],[18,43],[19,42],[20,41],[21,40],[22,39]], dna: [[1,16],[2,15],[3,14],[4,13],[5,12],[6,11],[7,10],[8,9]] },
  mea: { rna: [[15,46],[16,45],[17,44],[18,43],[19,42],[20,41],[21,40],[22,39],[23,38]], dna: [[1,16],[2,15],[3,14],[4,13],[5,12],[6,11],[7,10],[8,9]] },
};
// an 8-bp DNA duplex CGCTAGCG & CGCTAGCG as oxDNA files (old topology format, hydrogen-bond sites on top of each other, a1 vectors facing each other)
const DUP = (() => {
  const seq = "CGCTAGCG", n = 16, rows = [];
  for (let s = 0; s < 2; s++) for (let k = 0; k < 8; k++) { const i = s * 8 + k; rows.push(`${s + 1} ${seq[k]} ${k > 0 ? i - 1 : -1} ${k < 7 ? i + 1 : -1}`); }
  const pos = [];
  for (let k = 0; k < 8; k++) pos.push([0.4, 0, 0.34 * k, -1, 0, 0]);
  for (let k = 0; k < 8; k++) pos.push([-0.4, 0, 0.34 * (7 - k), 1, 0, 0]);
  return { top: `${n} 2\n` + rows.join("\n") + "\n", dat: "t = 0\nb = 0 0 0\nE = 0 0 0\n" + pos.map((p) => p.map((x) => x.toFixed(6)).join(" ") + " 0 1 0 0 0 0 0 0 0").join("\n") + "\n" };
})();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(o.live || `http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function" && typeof spPredict === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(3)']").click());
  await page.waitForSelector("#rrRunBtn", { state: "attached", timeout: 30000 });
  await page.waitForTimeout(800);
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; try { Metro.getPlugin(s, "select").val(v); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);
  await setSel("rrMode", "seqpred");
  await page.evaluate(() => { rrModeChanged(); spMethodChanged(); });
  await page.waitForFunction(() => { const x = Array.from(document.getElementById("spMethod").options).find((y) => y.value === "centroid"); return !!x && !x.disabled; }, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const opts = await page.evaluate(() => Object.fromEntries(Array.from(document.getElementById("spMethod").options).map((x) => [x.value, { disabled: x.disabled, text: x.text }])));
  for (const m of ["centroid", "mea"]) check(`method ${m} is offered and enabled`, !!opts[m] && !opts[m].disabled && !/not in this build/.test(opts[m].text), JSON.stringify(opts[m]));
  const models = await page.evaluate(() => spEngine.versionInfo().then((v) => Object.keys(v.models || {})));
  check("version.models lists centroid, mea and oxpairs", ["centroid", "mea", "oxpairs"].every((k) => models.includes(k)), models.join(","));
  const predict = async () => { await page.evaluate(() => spPredict()); await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("spStage").textContent), null, { timeout: 300000 }); return page.textContent("#spStage"); };
  const run = async (method, seq, mol) => {
    await setSel("spMethod", method);
    await page.evaluate(() => spMethodChanged());
    await page.waitForTimeout(300);
    await page.evaluate(([s, mol]) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; document.getElementById("spSalt").value = "0.25"; const m = document.getElementById("spMolecule"); if (m) { m.value = mol; try { Metro.getPlugin(m, "select").val(mol); } catch (e) {} } }, [seq, mol]);
    const stage = await predict();
    const r = await page.evaluate(() => ({ pairs: spLast.pairs, method: spLast.method, predictor: spLast.version && spLast.version.predictor }));
    return { stage, r };
  };
  for (const m of ["centroid", "mea"]) {
    await setSel("spMethod", m);
    await page.evaluate(() => spMethodChanged());
    await page.waitForTimeout(300);
    const trade = await page.innerText("#spTradeoff");
    check(`${m}: honest line says baseline, nested, not a prediction model of the project`, /baseline/i.test(trade) && /nested/i.test(trade), trade.slice(0, 160));
    const a = await run(m, RNA_SEQ, "RNA");
    check(`${m}: RNA run finishes`, /^Done/.test(a.stage), a.stage);
    check(`${m}: RNA pairs equal the frozen Python (2K96)`, same(a.r.pairs.map((p) => [p[0], p[1]]).sort((x, y) => x[0] - y[0]), PY[m].rna), JSON.stringify(a.r.pairs));
    check(`${m}: result is labelled as a baseline`, /baseline/i.test(a.r.predictor || ""), a.r.predictor);
    const d = await run(m, "CGCTAGCG&CGCTAGCG", "DNA");
    check(`${m}: two DNA strands run and equal the frozen Python`, /^Done/.test(d.stage) && same(d.r.pairs.map((p) => [p[0], p[1]]).sort((x, y) => x[0] - y[0]), PY[m].dna), d.stage + " " + JSON.stringify(d.r.pairs));
  }
  // reference from oxDNA / oxRNA files: predict the duplex (auto, DNA), then choose the two files in the reference box
  const dup = await run("auto", "GCGATCGC&GCGATCGC", "DNA");   // the old topology format lists each strand 3'->5': the file CGCTAGCG is read as GCGATCGC
  check("duplex: auto prediction finishes", /^Done/.test(dup.stage), dup.stage);
  fs.writeFileSync(o.out + "_duplex.top", DUP.top); fs.writeFileSync(o.out + "_duplex.dat", DUP.dat);
  await page.setInputFiles("#spRefOxFiles", [o.out + "_duplex.top", o.out + "_duplex.dat"]);
  await page.waitForFunction(() => /F1/.test(document.getElementById("spRefMsg").textContent) || /not accepted|nucleotides but/.test(document.getElementById("spRefMsg").textContent), null, { timeout: 60000 });
  const msg = await page.textContent("#spRefMsg");
  check("oxDNA files: reference accepted, 8 pairs, pair F1 1.000 against the drawn candidate", /pairs: pair F1 1\.000/.test(msg.replace(/\s+/g, " ")) || /pair F1 1\.000/.test(msg), msg);
  check("oxDNA files: sequence check says the file's sequence is equal to the predicted one", /equal to the predicted one/.test(msg), msg);
  const refText = await page.evaluate(() => document.getElementById("spRefDb").value);
  check("oxDNA files: the pair list is in the reference box (1-based)", refText.trim().split("\n").length === 8 && refText.startsWith("1 16"), refText.slice(0, 40));
  await page.evaluate(() => { const e = document.getElementById("spRefMsg"); let p = e; while (p && p !== document.body) { p.scrollTop = 0; p = p.parentElement; } e.scrollIntoView({ block: "center" }); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: o.out + "_oxref.png" });
  // a configuration of another size is refused with a message
  fs.writeFileSync(o.out + "_short.top", "8 1\n" + DUP.top.split("\n").slice(1, 9).join("\n").replace(/^2 /gm, "1 ") + "\n");
  fs.writeFileSync(o.out + "_short.dat", DUP.dat.split("\n").slice(0, 3).concat(DUP.dat.split("\n").slice(3, 11)).join("\n") + "\n");
  await page.evaluate(() => { document.getElementById("spRefMsg").textContent = ""; });
  await page.setInputFiles("#spRefOxFiles", [o.out + "_short.top", o.out + "_short.dat"]);
  await page.waitForFunction(() => document.getElementById("spRefMsg").textContent.length > 0, null, { timeout: 60000 });
  const bad = await page.textContent("#spRefMsg");
  check("oxDNA files of another size are refused with a message", /nucleotides but the sequence has|not accepted/.test(bad), bad);
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally { await browser.close(); srv.close(); }
console.log(failed ? `${failed} FAILED` : `ALL PASS (${skipped} skipped)`);
process.exit(failed ? 1 : 0);
