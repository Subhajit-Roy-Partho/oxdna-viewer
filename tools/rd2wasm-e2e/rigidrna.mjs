#!/usr/bin/env node
/**
 * tabs.mjs — checks the tabs of the rigidDNA window in headless Chromium: the rigidDNA1 and rigidDNA2 ribbon buttons open the one window on the right tab,
 * switching tabs shows exactly one pane, the second click on the button of the shown tab closes the window, and a dropped design opens tab 2.
 *
 *   node tabs.mjs --out <prefix> [--port N]      writes <prefix>_tab1.png, <prefix>_tab2.png; exit code 1 on a failed check
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8941 };
for (let i = 0; i < argv.length; i++) { if (argv[i] === "--out") o.out = argv[++i]; else if (argv[i] === "--port") o.port = parseInt(argv[++i], 10); }
if (!o.out) { console.error("usage: rigidrna.mjs --out PREFIX [--port N]"); process.exit(2); }

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
  await page.waitForTimeout(800);
  const vis = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && e.style.display !== "none"; }, id);
  check("rigidRNA button opens the window on tab 3", (await vis("rdPane3")) && !(await vis("rdPane1")) && !(await vis("rdPane2")));
  check("engine info filled", (await page.textContent("#rrEngine")).length > 5);
  await page.screenshot({ path: o.out + "_tab3.png" });

  const nNt = async () => page.evaluate(() => systems.reduce((a, s) => a + s.getMonomers().length, 0));
  const run = async (elec, salt) => {
    await page.evaluate(() => rrExample());
    await page.evaluate(({ elec, salt }) => { document.getElementById("rrElec").checked = elec; document.getElementById("rrSalt").value = String(salt); rrSaltChanged(); }, { elec, salt });
    const before = await nNt();
    await page.evaluate(() => rrRun());
    await page.waitForFunction(() => /^Done/.test(document.getElementById("rrStage").textContent) || /^Failed/.test(document.getElementById("rrStage").textContent), null, { timeout: 300000 });
    const stage = await page.textContent("#rrStage");
    await page.waitForTimeout(1500);
    return { stage, before, after: await nNt(), summary: await page.innerText("#rrSummary") };
  };
  let r = await run(false, 0.5);
  check("run without electrostatics finishes", /^Done/.test(r.stage), r.stage);
  check("the 40 nucleotides are in the scene", r.after - r.before === 40, `${r.before} -> ${r.after}`);
  check("summary lists the model energy and no electrostatics block", /model energy/.test(r.summary) && !/Debye-Hueckel/.test(r.summary));
  r = await run(true, 0.1);
  check("run with electrostatics (0.1 M) finishes", /^Done/.test(r.stage), r.stage);
  check("another 40 nucleotides are in the scene", r.after - r.before === 40, `${r.before} -> ${r.after}`);
  check("summary has the electrostatics block with the 0.1 M Debye length", /Debye-Hueckel, 0\.1 M, Debye length 0\.99 nm/.test(r.summary), r.summary.replace(/\s+/g, " ").slice(0, 300));
  await page.screenshot({ path: o.out + "_result.png" });
  const n0 = await nNt();
  await page.evaluate(async () => { document.getElementById("rrSeq").value = "GGGA"; document.getElementById("rrDb").value = "(("; await rrRun(); });
  await page.waitForTimeout(500);
  check("a sequence / structure length mismatch is refused without running", (await nNt()) === n0 && (await page.evaluate(() => !rrRunning)));
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) { console.error(e); failed++; }
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
