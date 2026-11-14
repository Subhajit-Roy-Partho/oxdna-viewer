#!/usr/bin/env node
/**
 * rna_option.e2e.mjs - headless Chromium check of the Molecule: DNA / RNA option in the Edit tab
 * (select #NA_toggle): default from the loaded file, override by the user, Get sequence shows U in RNA,
 * Set sequence accepts U/T, DNA output unchanged.
 *
 *   node tests/rna_option.e2e.mjs [--port N]      exit code 1 on a failed check
 * Needs playwright-core (tools/oxview-render/node_modules, or PLAYWRIGHT_CORE=<path>) and a Playwright chromium
 * in ~/.cache/ms-playwright (or CHROME_PATH).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const port = argv.includes("--port") ? parseInt(argv[argv.indexOf("--port") + 1], 10) : 8791;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(port, "127.0.0.1", r));

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
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

async function fresh() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof getSelectedSeqWrapper === "function" && !!document.getElementById("NA_toggle"), null, { timeout: 120000 });
  return page;
}
const load = async (page, files) => {
  const n0 = await page.evaluate(() => systems.length);
  await page.evaluate((files) => handleFiles(files.map((f) => new File([f.text], f.name))), files);
  await page.waitForFunction((n) => systems.length > n && systems[systems.length - 1].strands.length > 0, n0, { timeout: 60000 });
  await page.waitForTimeout(1500);
};
const selectAll = (page, si = 0) => page.evaluate((si) => { clearSelection(); systems[si].strands.forEach((s) => api.selectElements(s.map((e) => e), true)); }, si);
const toggle = (page, v) => page.evaluate((v) => { const s = document.getElementById("NA_toggle"); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, v);
const get = (page) => page.evaluate(() => { getSelectedSeqWrapper(); return document.getElementById("sequence").value; });
const setSeq = (page, seq) => page.evaluate((seq) => { document.getElementById("sequence").value = seq; setSeqWrapper(); }, seq);

try {
  // ---- DNA structure -------------------------------------------------------------------------------------------
  let page = await fresh();
  await load(page, [{ name: "tri.json.top", text: read("examples/triangle/tri.json.top") }, { name: "tri.json.oxdna", text: read("examples/triangle/tri.json.oxdna") }]);
  check("DNA file: molecule detected as DNA", await page.evaluate(() => systems[0].molecule) === "DNA");
  check("DNA file: Molecule select shows DNA", await page.evaluate(() => document.getElementById("NA_toggle").value) === "DNA");
  await page.evaluate(() => systems[0].strands[0].forEach((e) => e.select()));
  const dnaRaw = await page.evaluate(() => { let s = ""; systems[0].strands[0].forEach((e) => { s += e.type; }); return s; });
  const dnaGet = await get(page);
  check("DNA Get is identical to the stored types (has T, no U)", dnaGet === dnaRaw && dnaGet.includes("T") && !dnaGet.includes("U"), `${dnaGet.slice(0, 30)}... (${dnaGet.length})`);
  await toggle(page, "RNA");
  check("override to RNA is stored in the system", await page.evaluate(() => systems[0].molecule) === "RNA");
  const rnaGet = await get(page);
  check("RNA override: Get shows U instead of T", rnaGet === dnaRaw.replace(/T/g, "U") && !rnaGet.includes("T"), rnaGet.slice(0, 30));
  check("RNA override: stored types untouched (topology export unchanged)", await page.evaluate(() => systems[0].strands[0].getSequence()) === dnaRaw);
  check("RNA override: strand.getDisplaySequence() has U", await page.evaluate(() => systems[0].strands[0].getDisplaySequence()) === dnaRaw.replace(/T/g, "U"));
  // round trip: set what Get gave (U) on DNA nucleotides, read back
  await setSeq(page, rnaGet);
  check("Set with U on DNA nucleotides stores T", await page.evaluate(() => systems[0].strands[0].getSequence()) === dnaRaw);
  check("round trip RNA mode Get == Get", await get(page) === rnaGet);
  await toggle(page, "DNA");
  check("back to DNA: Get is the original again", await get(page) === dnaRaw);
  // set a new short sequence with U on 4 selected nucleotides, DNA mode
  await page.evaluate(() => { clearSelection(); const el = []; systems[0].strands[0].forEach((e) => el.push(e)); api.selectElements(el.slice(0, 4), true); });
  await setSeq(page, "ACGU");
  check("DNA mode: set ACGU, Get gives ACGT", await get(page) === "ACGT");
  await toggle(page, "RNA");
  await page.evaluate(() => { clearSelection(); const el = []; systems[0].strands[0].forEach((e) => el.push(e)); api.selectElements(el.slice(0, 4), true); });
  check("RNA mode: Get gives ACGU", await get(page) === "ACGU");
  check("no page errors (DNA run)", page.errors.length === 0, page.errors.join(" | "));
  await page.close();

  // ---- RNA structure -------------------------------------------------------------------------------------------
  page = await fresh();
  await load(page, [{ name: "rna12.top", text: read("examples/rna_option_example/rna12.top") }, { name: "rna12.dat", text: read("examples/rna_option_example/rna12.dat") }]);
  check("RNA file: molecule detected as RNA", await page.evaluate(() => systems[0].molecule) === "RNA");
  check("RNA file: Molecule select shows RNA", await page.evaluate(() => document.getElementById("NA_toggle").value) === "RNA");
  await selectAll(page);
  const rnaRaw = await page.evaluate(() => systems[0].strands[0].getSequence());
  const rna = await get(page);
  check("RNA Get = 5'-GGACUUCGGUCC-3'", rna === "GGACUUCGGUCC", rna);
  await setSeq(page, "GGACTTCGGTCC");   // T typed for RNA nucleotides
  check("Set with T on RNA nucleotides stores U", await page.evaluate(() => systems[0].strands[0].getSequence()) === rnaRaw);
  check("RNA round trip after Set with T", await get(page) === "GGACUUCGGUCC");
  await toggle(page, "DNA");   // user says: it is DNA. RNA nucleotides still hold U, unchanged
  check("RNA nucleotides in DNA mode: Get unchanged (U)", await get(page) === "GGACUUCGGUCC");
  check("JSON export carries molecule", await page.evaluate(() => JSON.parse(JSON.stringify(systems[0])).molecule) === "DNA");
  check("no page errors (RNA run)", page.errors.length === 0, page.errors.join(" | "));
  await page.close();

  // ---- DNA-model topology (new format) holding U: detected as RNA; JSON molecule honoured ------------------------
  page = await fresh();
  const newTop = "8 1 5->3\nGGAUCCAU id=1 type=DNA circular=false\n";
  await load(page, [{ name: "u.top", text: newTop }]);
  check("new-format top with U and no T: detected RNA", await page.evaluate(() => systems[0].molecule) === "RNA");
  await page.close();
  page = await fresh();
  await load(page, [{ name: "t.top", text: "8 1 5->3\nGGATCCAT id=1 type=DNA circular=false\n" }]);
  check("new-format top with T: detected DNA", await page.evaluate(() => systems[0].molecule) === "DNA");
  await page.close();
} finally {
  await browser.close();
  srv.close();
}
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
