#!/usr/bin/env node
/**
 * advanced.mjs — checks the "Advanced properties" section of the rigidDNA2 tab in headless Chromium, in the real window.
 *
 *   node advanced.mjs --design <file.json|.sc> --out <prefix> [--ox-top T --ox-dat D] [--port N] [--threads N] [--timeout MS]
 *
 * 1. the section is closed by default; screenshots of it closed and open (<prefix>_adv_closed.png, _adv_open.png, _adv_group.png);
 * 2. every field of the table has a control of the right type, blank passes nothing (the command line preview is the basic one);
 * 3. invalid entries are marked and not passed; "Reset advanced" clears everything;
 * 4. runs with default, with several options set (orientation search, route override, ...) and, when --ox-top/--ox-dat are given, with oxDNA-input options:
 *    the arguments that reach rd2_run in the worker (M.ccall of rd2w_run, captured inside the worker) are compared with the command line preview, and the log
 *    lines that show an option took effect are collected. Writes <prefix>.json; exit code 1 on a failed check.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const o = { port: 8951, threads: 1, timeout: 900000 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--design") o.design = argv[++i]; else if (a === "--out") o.out = argv[++i]; else if (a === "--port") o.port = parseInt(argv[++i], 10);
  else if (a === "--threads") o.threads = parseInt(argv[++i], 10); else if (a === "--timeout") o.timeout = parseInt(argv[++i], 10);
  else if (a === "--ox-top") o.oxTop = argv[++i]; else if (a === "--ox-dat") o.oxDat = argv[++i];
  else { console.error("unknown option " + a); process.exit(2); }
}
if (!o.design || !o.out) { console.error("usage: advanced.mjs --design FILE --out PREFIX [--ox-top T --ox-dat D]"); process.exit(2); }

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

const rec = { checks: [], runs: [] };
let failed = false;
const check = (name, ok, detail) => { rec.checks.push({ name, ok: !!ok, detail }); if (!ok) failed = true; console.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : "")); };

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.stack) || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text() + (m.location() && m.location().url ? " " + m.location().url : "")); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  const workerCaptured = [];
  page.on("worker", async (w) => {   // capture what the module is called with, inside the worker
    if (!/rd2_worker\.js/.test(w.url())) return;
    for (let k = 0; k < 50; k++) {
      try {
        await w.evaluate(() => { if (self.__rd2Patched) return; self.__rd2Patched = true; let n = 0; const wait = setInterval(() => {
          if (++n > 3000) clearInterval(wait);
          if (self.Rd2Api && self.Rd2Api.run && !self.Rd2Api.__p) {
            self.Rd2Api.__p = true; clearInterval(wait);
            const run = self.Rd2Api.run;
            self.Rd2Api.run = (M, i, o, h) => {   // the arguments of the call into the module, exactly as rd2w_run receives them
              if (!M.__p) { M.__p = true; const c = M.ccall.bind(M); M.ccall = (nm, r, ty, a) => { if (nm === "rd2w_run") self.postMessage({ type: "argv", argv: a[2], design: a[0], prefix: a[1] }); return c(nm, r, ty, a); }; }
              return run(M, i, o, h);
            };
          } }, 5); });
        break;
      } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  });
  await page.addInitScript(() => {   // the argv message of the patched worker, recorded in the page
    const orig = Worker.prototype.postMessage;
    window.__argvs = [];
    const add = Worker.prototype.addEventListener;
    const mk = Worker;
    window.Worker = function (...a) { const w = new mk(...a); w.addEventListener("message", (ev) => { if (ev.data && ev.data.type === "argv") window.__argvs.push(ev.data); }); return w; };
    window.Worker.prototype = mk.prototype;
  });
  await page.goto(`http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof handleFiles === "function" && typeof rigidDnaOpen === "function", null, { timeout: 120000 });
  await page.evaluate(() => rigidDnaOpen(2));
  await page.waitForSelector("#rd2Input", { state: "attached", timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("rd2Engine").textContent.length > 5 && !!window.Rd2Api && document.getElementById("rd2Cmd").textContent.startsWith("rd2_run"), null, { timeout: 30000 });
  await page.setInputFiles("#rd2Input", o.design);
  await page.waitForFunction(() => !document.getElementById("rd2RunBtn").disabled, null, { timeout: 30000 });
  const th = await page.evaluate((t) => { const e = document.getElementById("rd2Threads"); e.value = String(Math.min(t, parseInt(e.max) || 1)); e.dispatchEvent(new Event("input", { bubbles: true })); return parseInt(e.value); }, o.threads);
  rec.threads = th;

  // ---- 1. closed by default
  const open = (sel) => page.evaluate((s) => { const f = document.querySelector(s); return f && f.closest(".frame") && f.closest(".frame").classList.contains("active"); }, sel);
  check("Advanced properties is closed by default", !(await open("#rd2AdvAcc > .frame > .heading")));
  await page.evaluate(() => document.getElementById("rd2AdvAcc").scrollIntoView());
  await page.screenshot({ path: o.out + "_adv_closed.png" });
  const countText = await page.textContent("#rd2AdvCount");
  check("no count shown while nothing is set", countText.trim() === "", countText);
  const basic = await page.evaluate(() => document.getElementById("rd2Cmd").getAttribute("data-args"));
  check("blank advanced fields: the command line holds the basic options only", basic.split("\n").every((x) => ["--infer-staples", "auto", "--threads", "--no-linkers"].includes(x) || /^\d+$/.test(x)), basic);

  // ---- 2. open it, every control of the table is there
  await page.click("#rd2AdvAcc > .frame > .heading");
  await page.waitForTimeout(500);
  check("Advanced properties opens on click", await open("#rd2AdvAcc > .frame > .heading"));
  const fields = await page.evaluate(() => RD2_OPTS.map((x) => {
    const e = document.getElementById(rd2AdvId(x, x.kind === "pair" ? "a" : ""));
    return { id: x.id, flag: x.flag, kind: x.kind, tag: e && e.tagName, type: e && e.type };
  }));
  const missing = fields.filter((f) => !f.tag);
  check(`all ${fields.length} table options have a control`, missing.length === 0, missing.map((f) => f.flag));
  const bad = fields.filter((f) => (f.kind === "int" || f.kind === "num" || f.kind === "pair") !== (f.type === "number") && (f.kind === "int" || f.kind === "num" || f.kind === "pair"));
  check("numeric options use number inputs", bad.length === 0, bad.map((f) => f.flag));
  rec.fieldCount = fields.length;
  await page.evaluate(() => document.getElementById("rd2AdvAcc").scrollIntoView());
  await page.screenshot({ path: o.out + "_adv_open.png" });
  // open the first inner group by a real click and look at it
  const headings = await page.$$("#rd2AdvHost .accordion > .frame > .heading");
  check("option groups are accordion frames", headings.length >= 10, headings.length);
  await headings[2].click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { const h = document.querySelectorAll("#rd2AdvHost .accordion > .frame > .heading")[2]; h.scrollIntoView(); });
  await page.screenshot({ path: o.out + "_adv_group.png" });

  // ---- helpers
  const cmd = async () => page.evaluate(() => ({ text: document.getElementById("rd2Cmd").textContent, args: document.getElementById("rd2Cmd").getAttribute("data-args") }));
  const ensureOpen = async (id) => {   // open the group frame that holds the field, by clicking its heading as a user does
    const hd = await page.evaluateHandle((i) => { const f = document.getElementById(i).closest(".frame"); return f && !f.classList.contains("active") ? f.querySelector(":scope > .heading") : null; }, id);
    if (hd.asElement()) { await hd.asElement().scrollIntoViewIfNeeded(); await hd.asElement().click(); await page.waitForTimeout(350); }
  };
  const centerClick = async (sel) => {   // scroll to the middle (the tab bar of the window is sticky and would cover the top) and click as a user does
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel);
    await page.click(sel, { timeout: 15000 });
  };
  const tick = async (id) => { await ensureOpen(id); await centerClick(`label.checkbox:has(#${id})`); };
  const typeInto = async (id, v) => { await ensureOpen(id); await page.fill("#" + id, v); };
  const clickSelect = async (id, value) => {   // a real click on the Metro select and on its list entry
    await ensureOpen(id);
    const wrap = await page.evaluateHandle((i) => document.getElementById(i).closest(".select") || document.getElementById(i).parentElement, id);
    await wrap.asElement().evaluate((e) => e.scrollIntoView({ block: "center" }));
    await wrap.asElement().click();
    await page.waitForTimeout(200);
    const item = await page.evaluateHandle(({ i, v }) => {
      const w = document.getElementById(i).closest(".select");
      const lis = Array.from(w.querySelectorAll("li")).filter((l) => (l.getAttribute("data-value") || "") === v || l.textContent.trim() === v);
      return lis[0] || null;
    }, { i: id, v: value });
    if (!item.asElement()) throw new Error("no list entry " + value + " in " + id);
    await item.asElement().click();
    await page.waitForTimeout(200);
  };
  const reset = async () => { await page.evaluate(() => rd2AdvReset()); };

  // ---- 3. validation
  await typeInto("rd2a_orientSearch", "1.5");
  let h = await page.textContent("#rd2a_orientSearch_hint");
  check("1.5 for an integer field is marked and ignored", /Ignored: must be a whole number/.test(h) && !(await cmd()).args.includes("--orient-search"), h);
  await typeInto("rd2a_orientSearch", "-3");
  h = await page.textContent("#rd2a_orientSearch_hint");
  check("-3 is below the minimum: marked and ignored", /Ignored: must be at least 0/.test(h) && !(await cmd()).args.includes("--orient-search"), h);
  check("the invalid field is marked red", await page.evaluate(() => document.getElementById("rd2a_orientSearch").classList.contains("rd2-invalid")));
  check("the count says one entry is ignored", /1 ignored/.test(await page.textContent("#rd2AdvCount")), await page.textContent("#rd2AdvCount"));
  check("the problem line under Reset advanced shows it", /invalid/.test(await page.textContent("#rd2AdvProblems")));
  await typeInto("rd2a_mlCuts", "40,x");
  h = await page.textContent("#rd2a_mlCuts_hint");
  check("a bad list entry is marked and ignored", /Ignored: comma separated list/.test(h) && !(await cmd()).args.includes("--ml-cuts"), h);
  await typeInto("rd2a_orientScreen_a", "30");
  h = await page.textContent("#rd2a_orientScreen_hint");
  check("a half-filled pair is marked and ignored", /both values/.test(h) && !(await cmd()).args.includes("--orient-screen"), h);
  await typeInto("rd2a_dmin", "1e99");
  h = await page.textContent("#rd2a_dmin_hint");
  check("1e99 is above the maximum: marked and ignored", /at most/.test(h) && !(await cmd()).args.includes("--dmin"), h);
  await page.evaluate(() => document.getElementById("rd2AdvAcc").scrollIntoView());
  await page.screenshot({ path: o.out + "_adv_invalid.png" });
  await reset();
  const afterReset = await cmd();
  check("Reset advanced clears the fields, hints and the count", afterReset.args === basic && (await page.textContent("#rd2AdvCount")).trim() === "" && (await page.textContent("#rd2a_orientSearch_hint")) === "" && !(await page.evaluate(() => document.getElementById("rd2a_orientSearch").classList.contains("rd2-invalid"))), afterReset.args);

  // ---- 4. runs
  const runOnce = async (label, setup, input) => {
    await reset();
    await setup();
    const c = await cmd();
    const nBefore = await page.evaluate(() => window.__argvs.length);
    await page.evaluate(() => { document.getElementById("rd2Log").textContent = ""; });
    await centerClick("#rd2RunBtn");
    await page.waitForFunction(() => /^Done in/.test(document.getElementById("rd2Stage").textContent) || /^Failed/.test(document.getElementById("rd2Stage").textContent) || /^Stopped/.test(document.getElementById("rd2Stage").textContent), null, { timeout: o.timeout, polling: 500 });
    const stage = await page.textContent("#rd2Stage");
    const log = await page.textContent("#rd2Log");
    const got = await page.evaluate((n) => window.__argvs.slice(n), nBefore);
    const argvReceived = got.length ? got[got.length - 1].argv : null;
    const summary = (await page.textContent("#rd2Summary")).replace(/\s+/g, " ").trim();
    const r = { label, preview: c.text, previewArgs: c.args, argvReceived, stage, summary, logLines: log.split("\n").filter((l) => /^\$ |route|orient|input layout|ox-|oxDNA|start:|prepare:|coarse:|native relax|result:|ERROR|WARNING/.test(l)).slice(0, 40) };
    r.match = argvReceived !== null && argvReceived === c.args;
    rec.runs.push(r);
    check(`[${label}] arguments received by the engine = command line preview`, r.match, { preview: c.args.replace(/\n/g, " "), received: argvReceived && argvReceived.replace(/\n/g, " ") });
    check(`[${label}] logged command line is the preview`, log.split("\n")[0] === "$ " + c.text, log.split("\n")[0]);
    return r;
  };
  const r0 = await runOnce("default", async () => {});
  check("[default] run finished", /^Done in/.test(r0.stage), r0.stage);
  const r1 = await runOnce("orient-search 30 seed 7, dmin 3.0, subho 8", async () => {
    await typeInto("rd2a_orientSearch", "30"); await typeInto("rd2a_orientSeed", "7"); await typeInto("rd2a_dmin", "3.0"); await typeInto("rd2a_subho", "8");
  });
  check("[orient] the engine log reports the v2 orientation search with 30 starts (the \"v2 search\" box is ticked by default and --orient-fast is passed with explicit starts)", r1.logLines.some((l) => /^orientation search v2: 30 starts/.test(l)), r1.logLines.filter((l) => /^orientation search/.test(l)));
  const en = (r) => { const m = /E \/ nt \(oxDNA2\)(-?[\d.]+)/.exec(r.summary); return m ? Number(m[1]) : null; };
  check("[orient] the options change the result (E/nt differs from the default run)", en(r0) !== null && en(r1) !== null && en(r0) !== en(r1), [en(r0), en(r1)]);
  const r2 = await runOnce("route lattice via real click, no-exc, stop-early off", async () => {
    await page.selectOption("#rd2Route", "lattice").catch(() => {});
    await page.evaluate(() => { const s = document.getElementById("rd2Route"); s.value = "lattice"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await tick("rd2a_noExc");
    await clickSelect("rd2a_dist", "1");
  });
  const r3 = await runOnce("route-only (stops, no structure)", async () => { await clickSelect("rd2a_stop", "route-only"); });
  check("[route-only] the run reports it stopped and shows the route line", /^Stopped/.test(r3.stage) && r3.logLines.some((l) => /^route:/.test(l)), r3.stage);
  if (o.oxTop && o.oxDat) {
    await page.setInputFiles("#rd2Input", [o.oxTop, o.oxDat]);
    await page.waitForFunction((n) => document.getElementById("rd2File").textContent.startsWith(n), path.basename(o.oxTop), { timeout: 30000 });
    const rA = await runOnce("oxDNA input, defaults", async () => {});
    const rB = await runOnce("oxDNA input: input-layout off, ox-start on, ox-pair-extend 2", async () => {
      await clickSelect("rd2a_inputLayout", "off"); await clickSelect("rd2a_oxStart", "on"); await typeInto("rd2a_oxPairExtend", "2");
    });
    check("[oxDNA input] the options appear in the received arguments", /--input-layout\noff\n--ox-start\non\n--ox-pair-extend\n2\n--dat\n/.test(rB.argvReceived || ""), rB.argvReceived);
    check("[oxDNA input] the engine log reports the start from the input frames (--ox-start on) only in the second run", rB.logLines.some((l) => /oxDNA start:/.test(l)) && !rA.logLines.some((l) => /oxDNA start:/.test(l)), rB.logLines.filter((l) => /oxDNA start/.test(l)));
  }
  rec.pageErrors = errors.slice(0, 10);
  check("no page errors or failed requests", errors.length === 0, errors.slice(0, 5));
} catch (e) {
  console.error("advanced FAILED: " + e.stack);
  failed = true; rec.exception = String(e.stack || e);
}
fs.writeFileSync(o.out + ".json", JSON.stringify(rec, null, 1));
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
