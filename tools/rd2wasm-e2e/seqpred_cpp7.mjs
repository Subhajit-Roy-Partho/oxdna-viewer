#!/usr/bin/env node
/**
 * seqpred_cpp7.mjs: checks the methods added by lane CPP-7 (oriLayout, annotate3d, evalPairs, fail1Lib) through the module worker of the page in headless Chromium
 * (the same wasm/seqpred/seqpred_worker.js and build id as the seqpred tab; the page itself is loaded first, so a console / page error of the viewer is counted).
 *
 *   node seqpred_cpp7.mjs [--port N] [--live https://host/path/index.html] [--fixtures DIR] [--max-nt N]    exit code 1 on a failed check
 *
 * --fixtures DIR: a directory with cpp7_ori_small.json and cpp7_annot_small.json (cases and the results of the frozen Python, from the source repository of the package);
 * without it only the self-contained checks (version block, evalPairs, fail1Lib, error handling) run.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8967, maxNt: 4000 };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--port") o.port = parseInt(argv[++i], 10);
  else if (argv[i] === "--live") o.live = argv[++i];
  else if (argv[i] === "--fixtures") o.fixtures = argv[++i];
  else if (argv[i] === "--max-nt") o.maxNt = parseInt(argv[++i], 10);
}

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

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(o.live || `http://127.0.0.1:${o.port}/index.html`, { waitUntil: "load", timeout: 120000 });
  // the module worker, started the way the seqpred tab starts it
  const info = await page.evaluate(async () => {
    const b = await (await fetch(new URL("wasm/seqpred/build.json", document.baseURI).href, { cache: "no-store" })).json();
    const base = new URL("wasm/seqpred/", document.baseURI).href;
    const w = new Worker(base + "seqpred_worker.js?v=" + encodeURIComponent(b.build));
    let nextId = 1;
    const pending = new Map();
    window.__spw = (type, extra) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage(Object.assign({ type, id }, extra));
    });
    const ready = await new Promise((resolve, reject) => {
      w.onerror = (ev) => reject(new Error(ev.message || "worker failed to load"));
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "ready") resolve(m);
        else if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.type === "error") p.reject(new Error(m.message)); else p.resolve(m.result); }
      };
      w.postMessage({ type: "init", base, variant: "st", build: b.build });
    });
    return { build: b, variant: ready.variant, models: Object.keys((ready.version && ready.version.models) || {}), builder: ready.version && ready.version.build };
  });
  check("worker ready (single-thread module)", info.variant === "st", JSON.stringify({ variant: info.variant, build: info.build.build }));
  check("version.models lists oriLayout, annotate3d, evalPairs, fail1Lib", ["oriLayout", "annotate3d", "evalPairs", "fail1Lib"].every((k) => info.models.includes(k)), info.models.join(","));
  const call = (method, request) => page.evaluate(([m, r]) => window.__spw("call", { method: m, request: r }).then((x) => ({ ok: true, r: x }), (e) => ({ ok: false, msg: String(e.message || e) })), [method, request]);

  // self-contained checks
  const e = await call("evalPairs", { native: "1-10;2-9", pred: "1-10;3-8", n: 10 });
  check("evalPairs: tp 1, F1 0.5", e.ok && e.r.tp === 1 && e.r.F1 === 0.5, JSON.stringify(e.r));
  const f1 = await call("fail1Lib", { op: "defaultRingSize", n: 6 });
  check("fail1Lib defaultRingSize(6) = 3", f1.ok && same(f1.r.result, 3), JSON.stringify(f1.r));
  const f2 = await call("fail1Lib", { op: "nestedOnly", pairs: [[1, 10], [5, 15], [2, 9]] });
  check("fail1Lib nestedOnly keeps the nested pairs", f2.ok && same(f2.r.result, [[1, 10], [2, 9]]), JSON.stringify(f2.r));
  const bad = await call("evalPairs", { native: "1-2-3", pred: "1-5" });
  check("evalPairs: a malformed pair token is an error, not a crash", !bad.ok, bad.msg || "");
  const bad2 = await call("annotate3d", {});
  check("annotate3d: a request without text is an error", !bad2.ok, bad2.msg || "");

  // fixtures: cases and the results of the frozen Python
  if (o.fixtures) {
    const ori = JSON.parse(fs.readFileSync(path.join(o.fixtures, "cpp7_ori_small.json"), "utf8")).filter((c) => c.expect.ok && c.lens.reduce((a, b) => a + b, 0) <= o.maxNt);
    let nOk = 0;
    for (const c of ori) {
      const r = await call("oriLayout", { lens: c.lens, pairs: c.pairs, mode: c.mode });
      const good = r.ok && r.r.ok && same(r.r.breaks, c.expect.breaks) && same(r.r.sites, c.expect.site) && r.r.nStrands === c.expect.n_strands && r.r.length === c.expect.length;
      if (good) nOk++; else console.log("  differs: " + c.id + " " + c.mode + (r.ok ? "" : " " + r.msg));
    }
    check(`oriLayout: ${nOk} of ${ori.length} fixture cases (ORI-1 / ORI-2, scaffold <= ${o.maxNt} nt) equal the frozen Python (breaks, sites, strands, length)`, ori.length > 0 && nOk === ori.length);
    const an = JSON.parse(fs.readFileSync(path.join(o.fixtures, "cpp7_annot_small.json"), "utf8"));
    let aOk = 0;
    for (const a of an) {
      const r = await call("annotate3d", { text: a.text });
      const good = r.ok && r.r.sequence === a.expect.sequence && r.r.dotbracketPk === a.expect.dotbracket_pk && same(r.r.reference.pairs, a.expect.reference_pairs);
      if (good) aOk++; else console.log("  differs: " + a.pdb + (r.ok ? "" : " " + r.msg));
    }
    check(`annotate3d: ${aOk} of ${an.length} fixture structures equal the frozen Python (sequence, dot-bracket with pseudoknots, reference pairs)`, an.length > 0 && aOk === an.length);
  } else console.log("SKIP  fixtures (no --fixtures DIR)");
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally { await browser.close(); srv.close(); }
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
