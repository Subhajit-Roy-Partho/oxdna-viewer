#!/usr/bin/env node
/**
 * seqpred_cpp5.mjs: checks lane CPP-5 in the "predict with seqpred" input of the rigidRNA tab in headless Chromium: the `auto` router (C++ port of scripts/seqpred/auto_route.py, ML3 unavailable in the
 * browser): offered, enabled and the default of the method selector, honest label with the ML3 caveat, the arm / reason / mlFallback rows of the summary, and the pair sets of the Python router run with
 * ML3 disabled (golden values from scripts/seqpred/auto_route.py with auto_route.find_pkiss patched to "not found") for a natural pseudoknot RNA (NAT-1), several DNA strands (MS-3), several RNA strands
 * (MS-2) and a 9-nt strand (nested MFE); screenshots at desktop and phone width.
 *
 *   node seqpred_cpp5.mjs --out <prefix> [--port N] [--live https://host/path/index.html]    exit code 1 on a failed check (--live: test a deployed viewer instead of the local copy)
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
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); else if (argv[i] === "--live") o.live = argv[++i]; else if (argv[i] === "--pdb") o.pdb = argv[++i]; else if (argv[i] === "--design") o.design = argv[++i]; }
if (!o.out) { console.error("usage: seqpred_cpp5.mjs --out PREFIX [--port N]"); process.exit(2); }

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
  await page.goto(o.live || `http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
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
  // ---- bld2: the 3D builder of lane BUILD-1 in C++ (library fetched on first use)
  const BLD2_C1 = [[2.528, 11.652, -38.1], [0.37, 7.222, -35.807], [0.705, 2.657, -32.876], [3.219, -0.67, -29.384], [6.957, -1.736, -25.577], [10.562, -0.215, -21.802], [12.751, 3.405, -18.384], [12.636, 8.051, -15.556], [10.05, 12.305, -13.361], [5.569, 14.875, -11.653], [0.345, 14.982, -10.138], [-4.247, 12.592, -8.465], [-7.024, 8.429, -6.33], [-7.349, 3.753, -3.568], [-5.327, -0.01, -0.205], [-1.788, -1.731, 3.573], [2.0, -0.842, 7.411], [4.646, 2.255, 10.905], [5.146, 6.813, 13.925], [3.214, 11.255, 16.277], [-0.905, 14.354, 18.094], [-6.045, 15.119, 19.631], [-10.903, 13.333, 21.236], [-10.81, 9.503, 24.506], [-9.094, 6.84, 28.412], [-6.934, 4.182, 32.963], [-4.473, 6.832, 36.703], [-1.782, 10.578, 39.818], [-1.489, 15.147, 43.578], [4.867, 12.784, 49.324], [2.614, 10.35, 43.418], [2.349, 10.374, 38.943], [2.29, 3.894, 36.48], [1.764, -0.034, 32.954], [-1.068, -1.032, 29.112], [-5.942, -0.84, 24.891], [-10.009, 0.323, 21.53], [-12.799, 3.356, 18.343], [-12.684, 8.006, 15.527], [-10.101, 12.263, 13.343], [-5.672, 14.852, 11.645], [-0.4, 14.949, 10.132], [4.169, 12.626, 8.48], [6.963, 8.413, 6.299], [7.325, 3.775, 3.551], [5.326, -0.01, 0.204], [1.783, -1.749, -3.555]];   // C1' of the Python bld2 (frozen) for the 47-nt natural pseudoknot RNA 2K96 with the NAT-1 structure: the crossing helix is set aside
  const libReq = [];
  page.on("request", (r) => { if (/bld2_lib\.bin/.test(r.url())) libReq.push(r.url()); });
  const hasBld2 = await page.evaluate(() => spEngine.versionInfo().then((v) => !!(v.models && v.models.bld2 && v.models.bld2.available)));
  if (!hasBld2) skip("bld2 checks", "this build has no bld2");
  else {
    // a 76-nt tRNA first (empty scene): the picture of a built structure with helices and loops
    await setSel("spMethod", "auto");
    await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, "GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA");
    check("tRNA auto prediction finishes (for bld2)", /^Done/.test(await predict()));
    await page.evaluate(() => spBuildBld2());
    await page.waitForFunction(() => /^(bld2 done|bld2 failed|Cancelled)/.test(document.getElementById("spBld2Msg").textContent), null, { timeout: 300000 });
    check("tRNA bld2 build finishes", /^bld2 done/.test(await page.textContent("#spBld2Msg")), await page.textContent("#spBld2Msg"));
    const trna = await page.evaluate(() => ({ nt: systems.reduce((a, s) => a + s.getMonomers().length, 0), loops: spLastBld2.loops.length, stems: spLastBld2.nStems, generic: spLastBld2.loops.filter((l) => l.generic).length }));
    check("tRNA: 76 nt in the scene, cloverleaf scaffold (4 stems, 5 loops)", trna.nt === 76 && trna.stems === 4 && trna.loops === 5 && trna.generic === 0, JSON.stringify(trna));
    await page.evaluate(() => { const w = document.getElementById("rrBlkSeqpred").closest(".window"); if (w) w.style.display = "none"; });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: o.out + "_bld2_trna_scene.png" });
    await page.evaluate(() => { const w = document.getElementById("rrBlkSeqpred").closest(".window"); if (w) w.style.display = ""; });
    await setSel("spMethod", "auto");
    await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, "GGGCUGUUUUUCUCGCUGACUUUCAGCCCCAAACAAAAAAGUCAGCA");
    check("2K96 auto prediction finishes (for bld2)", /^Done/.test(await predict()));
    const b3d = await page.innerText("#spBuild3d");
    check("3D block: fast layout and bld2 buttons, honest label (TM 0.31 / 0.28 vs 0.19, pseudoknots not built, clashes)", /fast layout/.test(b3d) && /bld2/.test(b3d) && /0\.31/.test(b3d) && /0\.28/.test(b3d) && /0\.19/.test(b3d) && /NOT built/.test(b3d) && /clashes/.test(b3d), b3d.slice(0, 300));
    check("bld2 button enabled for a single RNA strand", await page.evaluate(() => !document.getElementById("spBuildBld2Btn").disabled));
    const nBefore = await page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0));
    for (const round of [1, 2]) {
      const t0 = Date.now();
      await page.evaluate(() => spBuildBld2());
      await page.waitForFunction(() => /^(bld2 done|bld2 failed|Cancelled)/.test(document.getElementById("spBld2Msg").textContent), null, { timeout: 300000 });
      const msg = await page.textContent("#spBld2Msg");
      console.log("bld2 build", round, ((Date.now() - t0) / 1000).toFixed(1), "s:", msg);
      check(`bld2 build ${round} finishes`, /^bld2 done/.test(msg), msg);
    }
    const res = await page.evaluate(() => { const r = spLastBld2; return r ? { ok: r.ok, pdb: r.pdb, nStems: r.nStems, pk: r.nPkStemsUnplaced, ox: r.oxrna && { n: r.oxrna.n, top: !!r.oxrna.top, dat: !!r.oxrna.dat }, loops: r.loops.length, lib: r.library } : null; });
    check("bld2 result: 47 nt, oxRNA top / dat present, one pseudoknot stem set aside", !!res && res.ok && res.ox && res.ox.n === 47 && res.ox.top && res.ox.dat && res.pk === 1, JSON.stringify(res && { nStems: res.nStems, pk: res.pk, ox: res.ox, loops: res.loops }));
    const c1 = (res.pdb.split("\n").filter((l) => l.startsWith("ATOM") && l.slice(12, 16).trim() === "C1'")).map((l) => [parseFloat(l.slice(30, 38)), parseFloat(l.slice(38, 46)), parseFloat(l.slice(46, 54))]);
    const rmsd = Math.sqrt(c1.reduce((a, p, i) => a + (p[0] - BLD2_C1[i][0]) ** 2 + (p[1] - BLD2_C1[i][1]) ** 2 + (p[2] - BLD2_C1[i][2]) ** 2, 0) / c1.length);
    check("bld2 C1' coordinates equal the Python bld2 (RMSD <= 0.05 A)", c1.length === 47 && rmsd <= 0.05, "RMSD " + rmsd.toFixed(5));
    const nAfter = await page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0));
    check("the oxRNA model of bld2 is loaded into the scene (47 nt more)", nAfter - nBefore >= 47, nBefore + " -> " + nAfter);
    check("the library was fetched ONCE for two builds", libReq.length === 1, JSON.stringify(libReq));
    const sumb = (await page.innerText("#spBld2Result")).replace(/\s+/g, " ");
    check("bld2 summary: instances, not-built pseudoknot stem, stretched bonds, library", /loop instances/.test(sumb) && /pseudoknot \/ kissing-loop stem/.test(sumb) && /stretched/.test(sumb) && /PDB chains/.test(sumb), sumb.slice(0, 400));
    await page.evaluate(() => { const e = document.getElementById("spBuild3d"); if (e) e.scrollIntoView(); });
    await page.screenshot({ path: o.out + "_bld2_panel.png" });
    await page.evaluate(() => { const w = document.getElementById("rrBlkSeqpred").closest(".window"); if (w) w.style.display = "none"; });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: o.out + "_bld2_scene.png" });
    await page.evaluate(() => { const w = document.getElementById("rrBlkSeqpred").closest(".window"); if (w) w.style.display = ""; });
    // DNA input: the bld2 button is disabled (one RNA chain only)
    await page.evaluate((s) => { document.getElementById("rrSeq").value = s; document.getElementById("rrDb").value = ""; }, "GGGCAAAAGCCC&CCGGTTTTCCGG&ATATGCGCATAT");
    await predict();
    check("bld2 button disabled for several DNA strands", await page.evaluate(() => document.getElementById("spBuildBld2Btn").disabled));
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
