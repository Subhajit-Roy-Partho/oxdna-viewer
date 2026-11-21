#!/usr/bin/env node
/**
 * seqpred_cpp12.mjs: checks ours-v2 (CPP-12) through the bridge of the seqpred tab (SeqpredEngine.predictOurs2: fetches wasm/seqpred/ours2_pack.json, loads it into the worker, runs) and the worker messages 'ours2load' / 'ours2', in the page in headless Chromium
 * (the same wasm/seqpred/seqpred_worker.js and build id as the seqpred tab; the page itself is loaded first, so a console / page error of the viewer is counted).
 *
 *   node seqpred_cpp12.mjs [--port N] [--live https://host/path/index.html] [--fixtures DIR]    exit code 1 on a failed check
 *
 * --fixtures DIR: a directory with cpp12_ours_v2_small.json (rigidDNA2 data/seqpred/golden; structures of the Python); without it only the self-contained checks run.
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
  const early = await page.evaluate(async () => { const e = new SeqpredEngine(); try { return await e.predictOurs2("GGGGAAAACCCC"); } finally { e.cancel(); } });
  check("bridge predictOurs2 on a 12-mer gives a 12-char structure with pairs", early && typeof early.db === "string" && early.db.length === 12 && Array.isArray(early.pairs) && early.pairs.length > 0, JSON.stringify(early).slice(0, 200));
  const refused = await page.evaluate(async () => { const e = new SeqpredEngine(); try { await e.predictOurs2("ACGX"); return null; } catch (x) { return x.message; } finally { e.cancel(); } });
  check("bridge predictOurs2 refuses a sequence outside ACGU", typeof refused === "string" && refused.length > 0, String(refused));
  if (o.fixtures) {
    const cases = JSON.parse(fs.readFileSync(path.join(o.fixtures, "cpp12_ours_v2_small.json"), "utf8")).filter((c) => c.seq.length <= 110);
    const res = await page.evaluate(async (seqs) => { const e = new SeqpredEngine(); const out = []; try { for (const s of seqs) out.push((await e.predictOurs2(s)).db); } finally { e.cancel(); } return out; }, cases.map((c) => c.seq));
    cases.forEach((c, i) => check(`ours-v2 ${c.id} (${c.seq.length} nt) equals the Python`, res[i] === c.expect.db));
  } else console.log("SKIP  fixtures (no --fixtures DIR)");
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally { await browser.close(); srv.close(); }
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
