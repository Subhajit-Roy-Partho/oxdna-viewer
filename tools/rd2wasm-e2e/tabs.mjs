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
if (!o.out) { console.error("usage: tabs.mjs --out PREFIX [--port N]"); process.exit(2); }

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
// the window opens centred, on top of the ribbon: click the ribbon button through the DOM
let ribbon = null;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function", null, { timeout: 120000 });

  ribbon = (n) => page.evaluate((n) => document.querySelector(`button[onclick='rigidDnaOpen(${n})']`).click(), n);
  const state = () => page.evaluate(() => {
    const w = document.getElementById("rigidDNAWindow");
    const vis = (id) => { const e = document.getElementById(id); return !!e && e.style.display !== "none"; };
    return { window: !!w, pane1: vis("rdPane1"), pane2: vis("rdPane2"), tab1: document.getElementById("rdTabBtn1")?.classList.contains("rd-active"),
      tab2: document.getElementById("rdTabBtn2")?.classList.contains("rd-active"), shown: !!w && w.offsetParent !== null && getComputedStyle(w).display !== "none" };
  });

  // the rigidDNA buttons are in the Dynamics section of the ribbon
  await page.click("a[href='#section-dynamics']");
  await page.waitForTimeout(500);

  // ribbon button rigidDNA1 -> window on tab 1
  await ribbon(1);
  await page.waitForSelector("#rdPane1", { timeout: 30000 });
  await page.waitForSelector("#rd2Input", { state: "attached", timeout: 30000 });
  await page.waitForTimeout(800);
  let s = await state();
  check("rigidDNA1 button opens the window on tab 1", s.window && s.pane1 && !s.pane2 && s.tab1 && !s.tab2, JSON.stringify(s));
  await page.screenshot({ path: o.out + "_tab1.png" });
  check("rigidDNA1 controls exist (cluster button, run button, log)", await page.evaluate(() => !!document.getElementById("rigidDnaRunBtn") && !!document.getElementById("rigidDnaLog") && !!document.getElementById("rigidDnaClusterMode")));

  // ribbon button rigidDNA2 -> same window, tab 2
  await ribbon(2);
  await page.waitForTimeout(500);
  s = await state();
  check("rigidDNA2 button switches to tab 2", s.pane2 && !s.pane1 && s.tab2 && !s.tab1 && s.shown, JSON.stringify(s));
  check("only one rigidDNA window exists", await page.evaluate(() => document.querySelectorAll("#rigidDNAWindow").length === 1));
  check("rigidDNA2 engine info filled", (await page.textContent("#rd2Engine")).length > 5);
  await page.screenshot({ path: o.out + "_tab2.png" });

  // tab buttons inside the window
  await page.click("#rdTabBtn1");
  s = await state();
  check("tab button 1 shows pane 1", s.pane1 && !s.pane2 && s.tab1);
  await page.click("#rdTabBtn2");
  s = await state();
  check("tab button 2 shows pane 2", s.pane2 && !s.pane1 && s.tab2);

  // second click on the shown tab's ribbon button closes the window
  await ribbon(2);
  await page.waitForTimeout(400);
  s = await state();
  check("second click on the shown tab's button hides the window", s.window && !s.shown, JSON.stringify(s));
  await ribbon(1);
  await page.waitForTimeout(400);
  s = await state();
  check("rigidDNA1 button re-opens it on tab 1", s.shown && s.pane1 && !s.pane2, JSON.stringify(s));

  // a dropped caDNAno design goes to tab 2
  const design = '{"vstrands":[]}';   // only the file type matters here: nothing is run
  await page.evaluate(({ text }) => handleFiles([new File([text], "tiny.json")]), { text: design });
  await page.waitForTimeout(800);
  s = await state();
  check("a dropped design opens tab 2 and is held there", s.shown && s.pane2 && !s.pane1 && (await page.textContent("#rd2File")).includes("tiny.json"), JSON.stringify(s));

  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) { console.error(e); failed++; }
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
