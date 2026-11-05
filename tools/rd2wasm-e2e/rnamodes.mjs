#!/usr/bin/env node
/**
 * rnamodes.mjs — checks the inputs and the Advanced properties of the rigidRNA tab in headless Chromium: the input select shows the right controls, sequence-only
 * prediction, a PDB file, a design JSON and a sequence with a strand separator run through the engine and reach the scene, the advanced fields end up in the
 * command line preview (and in the log line `$ rd2_rna ...`), an invalid field is marked and not passed, Reset advanced clears everything.
 *
 *   node rnamodes.mjs --out <prefix> [--pdb 1EHZ.pdb] [--design hairpin_gaaa.json] [--port N]    exit code 1 on a failed check
 *   (the PDB and the design are in data/rna/pdb and data/rna/designs of the rigidRNA engine; without them those two runs are skipped)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8951 };
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); else if (argv[i] === "--pdb") o.pdb = argv[++i]; else if (argv[i] === "--design") o.design = argv[++i]; }
if (!o.out) { console.error("usage: rnamodes.mjs --out PREFIX [--port N]"); process.exit(2); }

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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function" && typeof rrRun === "function", null, { timeout: 120000 });
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("button[onclick='rigidDnaOpen(3)']").click());
  await page.waitForSelector("#rrRunBtn", { state: "attached", timeout: 30000 });
  await page.waitForFunction(() => !!window.Rd2RnaApi, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const vis = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && e.style.display !== "none"; }, id);
  const setMode = (m) => page.evaluate((m) => { const s = document.getElementById("rrMode"); s.value = m; try { Metro.getPlugin(s, "select").val(m); } catch (e) {} s.dispatchEvent(new Event("change", { bubbles: true })); rrModeChanged(); }, m);
  const nNt = () => page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0));
  const cmd = () => page.textContent("#rrCmd");
  const runAndWait = async () => {
    await page.evaluate(() => rrRun());
    await page.waitForFunction(() => /^(Done|Failed|Cancelled)/.test(document.getElementById("rrStage").textContent) || (!rrRunning && /refused|must/.test(document.getElementById("rrStage").textContent)), null, { timeout: 300000 });
    await page.waitForTimeout(1200);
    return { stage: await page.textContent("#rrStage"), summary: await page.innerText("#rrSummary"), log: await page.textContent("#rrLog") };
  };

  // 1. the input select
  check("default input: sequence + dot-bracket controls", (await vis("rrBlkSeq")) && (await vis("rrBlkDb")) && !(await vis("rrBlkPredict")) && !(await vis("rrBlkFile")));
  await setMode("predict");
  check("predict: sequence and predictor controls, no dot-bracket", (await vis("rrBlkSeq")) && !(await vis("rrBlkDb")) && (await vis("rrBlkPredict")) && !(await vis("rrBlkFile")));
  await setMode("pdb");
  check("pdb: file and chain / model controls", !(await vis("rrBlkSeq")) && (await vis("rrBlkFile")) && (await vis("rrBlkPdb")));
  await setMode("design");
  check("design: file control without chain / model", (await vis("rrBlkFile")) && !(await vis("rrBlkPdb")));
  await setMode("db");

  // 2. the command line preview follows the fields
  await page.evaluate(() => rrExample());
  let c = await cmd();
  check("preview starts with rd2_rna --seq ... --db ...", /^rd2_rna --seq GGGCGCGAAAACGCGCCC/.test(c) && /--db /.test(c) && /--salt 0\.5 --temp 300/.test(c), c.slice(0, 160));
  await page.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById("rra_" + id); if (e.type === "checkbox") e.checked = v; else e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
    set("minStem", "3"); set("noGu", true); set("dmin", "3.1"); set("noCompact", true); set("compactKc", "0.2"); set("toehold", "0-3, 20-25"); set("foldCheck", true); set("verbatim", "--compact-max-flat 0.3");
  });
  c = await cmd();
  for (const [what, re] of [["--min-stem 3", /--min-stem 3/], ["--no-gu", /--no-gu/], ["--dmin 3.1", /--dmin 3\.1/], ["--no-compact", /--no-compact/], ["--compact-kc 0.2", /--compact-kc 0.2/],
    ["two --toehold", /--toehold 0-3 --toehold 20-25/], ["--fold-check", /--fold-check/], ["verbatim --compact-max-flat 0.3", /--compact-max-flat 0\.3/]]) check("preview has " + what, re.test(c), re.test(c) ? "" : c);
  check("advanced count says 8 set", /8 set/.test(await page.textContent("#rrAdvCount")), await page.textContent("#rrAdvCount"));
  await page.evaluate(() => { const set = (id, v) => { const e = document.getElementById("rra_" + id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }; set("minStem", "2.5"); set("toehold", "5-2"); set("verbatim", "no-gu"); set("dmin", "0"); });
  c = await cmd();
  check("invalid entries are not in the command line", !/--min-stem/.test(c) && !/--toehold/.test(c) && !/--dmin/.test(c) && !/ no-gu/.test(c), c);
  check("invalid entries are marked and counted", (await page.evaluate(() => document.querySelectorAll("#rrAdvHost .rd2-invalid").length)) === 4 && /4 entries are invalid/.test(await page.textContent("#rrAdvProblems")), await page.textContent("#rrAdvProblems"));
  await page.evaluate(() => rrAdvReset());
  c = await cmd();
  check("Reset advanced clears the fields and the command line", !/--min-stem|--no-gu|--dmin|--toehold|--fold-check|--compact/.test(c) && (await page.textContent("#rrAdvCount")) === "", c);

  // 3. a sequence with a strand separator (two hairpins as two strands joined by a duplex is not needed: two chains of one duplex)
  await page.evaluate(() => { document.getElementById("rrSeq").value = "GGGGAAAAGCC&GGCUUUUCCCC"; document.getElementById("rrDb").value = "((((....(((&)))....))))"; });
  let n0 = await nNt();
  let r = await runAndWait();
  check("two strands with & run", /^Done/.test(r.stage), r.stage);
  check("22 nucleotides added (23 characters, one separator)", (await nNt()) - n0 === 22, `${n0} -> ${await nNt()}`);
  check("the log starts with the command line", /^\$ rd2_rna --seq /.test(r.log), r.log.slice(0, 120));

  // 4. sequence only
  await setMode("predict");
  await page.evaluate(() => { document.getElementById("rrSeq").value = "GGGGAAAACCCCAUGGGGAAAACCCCAU"; });
  n0 = await nNt();
  r = await runAndWait();
  check("sequence-only run finishes", /^Done/.test(r.stage), r.stage);
  check("28 nucleotides added", (await nNt()) - n0 === 28, `${n0} -> ${await nNt()}`);
  check("summary says the structure was predicted and shows it", /predicted by the engine/.test(r.summary) && /predicted structure/.test(r.summary) && /\(\(\(\(/.test(r.summary), r.summary.replace(/\s+/g, " ").slice(0, 300));
  await page.screenshot({ path: o.out + "_predict.png" });

  // 5. PDB file
  if (o.pdb && fs.existsSync(o.pdb)) {
    await setMode("pdb");
    await page.setInputFiles("#rrFile", o.pdb);
    await page.waitForFunction(() => /atom records/.test(document.getElementById("rrFileInfo").textContent), null, { timeout: 10000 });
    check("file info shows the atom count", /atom records/.test(await page.textContent("#rrFileInfo")), await page.textContent("#rrFileInfo"));
    await page.evaluate(() => { document.getElementById("rrIters").value = "60"; });
    n0 = await nNt();
    r = await runAndWait();
    check("PDB run finishes", /^Done/.test(r.stage), r.stage);
    check("the PDB nucleotides are added", (await nNt()) - n0 > 20, `${n0} -> ${await nNt()}`);
    check("preview / log carry --pdb", /--pdb 1EHZ|--pdb /.test(r.log.split("\n")[0]), r.log.split("\n")[0].slice(0, 120));
    await page.screenshot({ path: o.out + "_pdb.png" });
    await page.evaluate(() => { document.getElementById("rrIters").value = "300"; });
  } else console.log("SKIP  PDB run (no --pdb file)");

  // 6. design JSON
  if (o.design && fs.existsSync(o.design)) {
    await setMode("design");
    await page.setInputFiles("#rrFile", o.design);
    await page.waitForFunction(() => /kB/.test(document.getElementById("rrFileInfo").textContent), null, { timeout: 10000 });
    n0 = await nNt();
    r = await runAndWait();
    check("design JSON run finishes and adds nucleotides", /^Done/.test(r.stage) && (await nNt()) > n0, r.stage);
  } else console.log("SKIP  design run (no --design file)");

  // 7. the Advanced properties section, open (screenshots)
  await setMode("db");
  await page.evaluate(() => { document.querySelector("#rrAdvAcc > .frame > .heading").click(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { for (const h of document.querySelectorAll("#rrAdvHost .accordion > .frame > .heading")) h.click(); });
  await page.waitForTimeout(500);
  check("the advanced section holds one control per option of the table", (await page.evaluate(() => document.querySelectorAll("#rrAdvHost input").length)) === 19);
  await page.locator("#rrAdvAcc").scrollIntoViewIfNeeded();
  await page.screenshot({ path: o.out + "_advanced.png" });

  // 8. refusals
  await setMode("db");
  await page.evaluate(() => { document.getElementById("rrSeq").value = "GGGA"; document.getElementById("rrDb").value = "(("; });
  n0 = await nNt();
  await page.evaluate(async () => { await rrRun(); });
  check("a length mismatch is refused without running", (await nNt()) === n0 && (await page.evaluate(() => !rrRunning)));
  await page.evaluate(async () => { document.getElementById("rrSeq").value = "GGGAXC"; document.getElementById("rrDb").value = "((..))"; await rrRun(); });
  check("a letter that is not A, C, G, U, N is refused without running", (await nNt()) === n0 && (await page.evaluate(() => !rrRunning)));
  await setMode("pdb");
  await page.evaluate(async () => { await rrRun(); });
  check("a PDB run without a file is refused", (await nNt()) === n0 && (await page.evaluate(() => !rrRunning)));
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) { console.error(e); failed++; }
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
