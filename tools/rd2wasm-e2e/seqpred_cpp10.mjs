#!/usr/bin/env node
/**
 * seqpred_cpp10.mjs: checks the CPP-10 worker messages ({type:'srv', id, method, op, request} -> {type:'srved', id, result} | {type:'error', id, message, errorType, status}) through the module worker of the page in headless Chromium
 * (the same wasm/seqpred/seqpred_worker.js and build id as the seqpred tab; the page itself is loaded first, so a console / page error of the viewer is counted).
 *
 *   node seqpred_cpp10.mjs [--port N] [--live https://host/path/index.html] [--fixtures DIR]    exit code 1 on a failed check
 *
 * --fixtures DIR: a directory with cpp10_small.json (cases and the results of the frozen Python, from the source repository of the package);
 * without it only the self-contained checks (version block, unknown method, pairsToDotbracket) run.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const o = { port: 8970 };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--port") o.port = parseInt(argv[++i], 10);
  else if (argv[i] === "--live") o.live = argv[++i];
  else if (argv[i] === "--fixtures") o.fixtures = argv[++i];
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
// key-order-insensitive deep equality (sort the keys recursively before comparing; floats exactly)
const norm = (v) => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") { const o2 = {}; for (const k of Object.keys(v).sort()) o2[k] = norm(v[k]); return o2; }
  return v;
};
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
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
    const ready = await new Promise((resolve, reject) => {
      w.onerror = (ev) => reject(new Error(ev.message || "worker failed to load"));
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "ready") resolve(m);
        else if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m); }
      };
      w.postMessage({ type: "init", base, variant: "st", build: b.build });
    });
    window.__srv = (method, op, request) => new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      w.postMessage({ type: "srv", id, method, op, request });
    });
    return { build: b, variant: ready.variant, version: ready.version };
  });
  check("worker ready (single-thread module)", info.variant === "st", JSON.stringify({ variant: info.variant, build: info.build.build }));
  check("version block of the module is available", info.version && typeof info.version === "object" && Object.keys(info.version).length > 0, JSON.stringify(info.version).slice(0, 300));
  const call = (method, op, request) => page.evaluate(([m, x, r]) => window.__srv(m, x, r), [method, op, request]);

  // self-contained checks
  const unk = await call("noSuchMethod", "x", {});
  check("an unknown method message gives type error", unk.type === "error", JSON.stringify(unk).slice(0, 200));
  const pdb = await call("dotBracket", "pairsToDotbracket", { pairs: [[0, 8], [1, 7], [2, 6]], n: 9 });
  const db = pdb && pdb.result && typeof pdb.result === "object" ? pdb.result.dotbracket : pdb.result;
  check("dotBracket pairsToDotbracket [[[0,8],[1,7],[2,6]], n:9] gives (((...)))", pdb.type === "srved" && db === "(((...)))", JSON.stringify(pdb.result).slice(0, 200));

  // fixtures: cases and the results of the frozen Python
  if (o.fixtures) {
    const cases = JSON.parse(fs.readFileSync(path.join(o.fixtures, "cpp10_small.json"), "utf8"));
    const groups = new Map();
    for (const c of cases) {
      const k = c.request.method + "." + c.request.op;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    let totalPass = 0;
    for (const [k, list] of groups) {
      let nOk = 0;
      let firstDiff = "";
      for (const c of list) {
        const { method, op, ...args } = c.request;
        const m = await call(method, op, args);
        let good = false;
        if (c.expect.ok) {
          good = m.type === "srved" && same(m.result, c.expect.result);
        } else if (c.expect.errorType === "ValueError") {
          good = m.type === "error" && m.errorType === "ValueError";
        } else {
          good = m.type === "error" && m.errorType === c.expect.errorType && m.message === c.expect.error &&
            (c.expect.status === undefined || m.status === c.expect.status);
        }
        if (good) nOk++;
        else if (!firstDiff) firstDiff = JSON.stringify({ req: c.request, got: m }).slice(0, 500);
      }
      totalPass += nOk;
      check(`cpp10 ${k}: ${nOk}/${list.length}`, nOk === list.length, firstDiff);
    }
    console.log(`cpp10: ${totalPass}/${cases.length} cases identical`);
  } else console.log("SKIP  fixtures (no --fixtures DIR)");
  // the bridge of the seqpred tab (SeqpredEngine.server): a result, and a refusal with errorType / status
  const br = await page.evaluate(async () => {
    const e = new SeqpredEngine();
    const out = {};
    try {
      out.ok = await e.server("dotBracket", "pairsToDotbracket", { pairs: [[0, 8], [1, 7], [2, 6]], n: 9 });
      try { await e.server("seqInput", "parse", { text: "", molecule: "auto" }); out.refused = null; } catch (x) { out.refused = { message: x.message, errorType: x.errorType, status: x.status }; }
    } finally { e.cancel(); }
    return out;
  });
  check("SeqpredEngine.server: result", br.ok && br.ok.dotbracket === "(((...)))", JSON.stringify(br.ok));
  check("SeqpredEngine.server: refusal carries errorType and status", br.refused && br.refused.errorType === "InputError" && br.refused.status === 400, JSON.stringify(br.refused));
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally { await browser.close(); srv.close(); }
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
