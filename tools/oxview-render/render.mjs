#!/usr/bin/env node
/**
 * oxview-render — headless structure-image CLI for the oxDNA viewer.
 *
 * Serves this repo statically on a scratch port, loads one structure
 * (.oxview, or .top + .dat) through the viewer's own URL-param file
 * loader (readFilesFromURLParams -> readFilesFromURLPath -> handleFiles),
 * fits the camera, and captures the WebGL canvas to PNG via Playwright.
 *
 * Interface-only contract with sibling lanes: this tool reads plain
 * .oxview / .top / .dat files from disk. Nothing else is shared.
 *
 * Usage:
 *   node render.mjs --input <file.oxview | file.top> [--dat <file.dat>]
 *                   --out <image.png> [--width 1280] [--height 800]
 *                   [--rotate x,y,z] [--background #fff] [--select all|none|i,j..]
 *                   [--arrows] [--box] [--timeout 60000] [--port 8903]
 *
 * Exit codes: 0 ok · 2 usage/input error · 1 runtime/load/screenshot failure.
 * All failures print an actionable message to stderr.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
// Repo root = two levels up from tools/oxview-render (do not move this file
// without updating REPO_ROOT).
const REPO_ROOT = path.resolve(TOOL_DIR, "..", "..");

const SYSTEM_EXTS = new Set(["oxview", "top", "pdb", "cif", "mmcif", "xyz", "unf", "mgl"]);

// ---------------------------------------------------------------- args ----
function parseArgs(argv) {
  const o = {
    width: 1280, height: 800, rotate: "0,0,0", background: "#ffffff",
    select: "none", arrows: false, box: false, timeout: 60000, port: 8903,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = (name) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) {
        fail(2, `missing value for ${name}`);
      }
      return v;
    };
    switch (a) {
      case "--input": o.input = take(a); break;
      case "--dat": o.dat = take(a); break;
      case "--out": o.out = take(a); break;
      case "--width": o.width = parseInt(take(a), 10); break;
      case "--height": o.height = parseInt(take(a), 10); break;
      case "--rotate": o.rotate = take(a); break;
      case "--background": o.background = take(a); break;
      case "--select": o.select = take(a); break;
      case "--arrows": o.arrows = true; break;
      case "--box": o.box = true; break;
      case "--timeout": o.timeout = parseInt(take(a), 10); break;
      case "--port": o.port = parseInt(take(a), 10); break;
      case "--help": case "-h":
        console.log(HELP);
        process.exit(0);
      default:
        fail(2, `unknown argument: ${a}\n${HELP}`);
    }
  }
  return o;
}

const HELP = `oxview-render — headless oxView structure screenshots
Usage:
  node render.mjs --input <file.oxview|file.top> [--dat <file.dat>] --out <img.png> [opts]
Options:
  --input PATH        structure file (.oxview, .top, .pdb/.cif/...)           [required]
  --dat PATH          configuration file for --input X.top (default: X.dat sibling)
  --out PATH          output PNG path                                          [required]
  --width N           viewport width  (default 1280)
  --height N          viewport height (default 800)
  --rotate x,y,z      camera orbit degrees around target (default 0,0,0)
  --background COLOR  canvas background CSS color (default #ffffff)
  --select SEL        none | all | comma strand indices, e.g. 0,2 (default none)
  --arrows            keep coordinate-axis arrows (default: hidden)
  --box               show simulation box (default: hidden)
  --timeout MS        max wait for structure load (default 60000)
  --port N            scratch static-server port (default 8903; auto-bumps if busy)`;

function fail(code, msg) {
  process.stderr.write(`oxview-render: ${msg}\n`);
  process.exit(code);
}

// ------------------------------------------------------------ validation --
function validate(o) {
  if (!o.input) fail(2, "--input is required (see --help).");
  if (!o.out) fail(2, "--out is required (see --help).");
  if (!fs.existsSync(o.input)) fail(2, `input not found: ${o.input}`);
  const rawExt = path.extname(o.input).slice(1).toLowerCase();
  // Accept trailing ".json" on system formats (our exporter writes ".oxview.json").
  const base = path.basename(o.input).toLowerCase();
  const ext = rawExt === "json" && base.endsWith(".oxview.json") ? "oxview" : rawExt;
  if (!SYSTEM_EXTS.has(ext)) {
    fail(2, `unsupported input extension ".${ext}" for ${o.input} ` +
      `(supported system files: ${[...SYSTEM_EXTS].join(", ")}). ` +
      `Raw .dat/.oxdna config files cannot load alone — pass the .top via --input.`);
  }
  if (ext === "top" && !o.dat) {
    const sib = o.input.replace(/\.top$/i, ".dat");
    if (fs.existsSync(sib)) o.dat = sib;
    else {
      fail(2, `topology ${o.input} has no configuration: pass --dat <file.dat> ` +
        `(looked for sibling ${sib}, not found).`);
    }
  }
  if (o.dat && !fs.existsSync(o.dat)) fail(2, `--dat file not found: ${o.dat}`);
  if (!Number.isFinite(o.width) || o.width <= 0) fail(2, `--width must be positive (got ${o.width}).`);
  if (!Number.isFinite(o.height) || o.height <= 0) fail(2, `--height must be positive (got ${o.height}).`);
  if (!Number.isFinite(o.timeout) || o.timeout <= 0) fail(2, `--timeout must be positive ms.`);
  const rot = String(o.rotate).split(",").map((s) => parseFloat(s.trim()));
  if (rot.length !== 3 || rot.some((n) => !Number.isFinite(n))) {
    fail(2, `--rotate must be "x,y,z" degrees (got "${o.rotate}").`);
  }
  o.rot = rot;
  return { ext };
}

// ---------------------------------------------------------- static server --
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".top": "text/plain", ".dat": "text/plain", ".oxdna": "text/plain",
  ".oxview": "application/json", ".pdb": "text/plain", ".cif": "text/plain",
};

function serveStatic(root, extraRoutes) {
  const srv = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/favicon.ico") {
        const icon = path.join(root, "favicon.png");
        if (fs.existsSync(icon)) {
          res.writeHead(200, { "Content-Type": "image/png" });
          fs.createReadStream(icon).pipe(res);
          return;
        }
      }
      const hit = extraRoutes.get(u.pathname);
      if (hit) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(hit).toLowerCase()] || "application/octet-stream" });
        fs.createReadStream(hit).pipe(res);
        return;
      }
      let p = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
      if (!p.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return; }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
      if (!fs.existsSync(p)) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(p).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return srv;
}

async function listen(srv, port) {
  for (let p = port; p < port + 10; p++) {
    try {
      await new Promise((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(p, "127.0.0.1", () => { srv.removeListener("error", reject); resolve(); });
      });
      return p;
    } catch (e) {
      if (e.code !== "EADDRINUSE") throw e;
    }
  }
  fail(1, `ports ${port}-${port + 9} all busy; pass a free --port.`);
}

// --------------------------------------------------------------- playwright --
function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright-core");
  } catch { /* try shared installs below */ }
  for (const base of (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean)) {
    try {
      return createRequire(path.join(base, "package.json"))("playwright-core");
    } catch { /* next */ }
  }
    fail(2, "playwright-core not found. Run `npm install` in tools/oxview-render/ " +
      "(one-time; node_modules/ stays gitignored).");
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  // Full Chromium builds first (WebGL via SwiftShader works), system
  // browsers next, headless-shell last: chrome-headless-shell has no WebGL
  // so every render fails with "Error creating WebGL context".
  const full = [];
  const shell = [];
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache)) {
      if (d.startsWith("chromium_headless_shell")) {
        const exe = path.join(cache, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
        if (fs.existsSync(exe)) shell.push(exe);
      } else if (d.startsWith("chromium")) {
        for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
          const exe = path.join(cache, d, sub);
          if (fs.existsSync(exe)) { full.push(exe); break; }
        }
      }
    }
  }
  // Also accept a system chromium if the cache is absent.
  const sys = [];
  for (const s of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (fs.existsSync(s)) sys.push(s);
  }
  for (const bucket of [full, sys, shell]) {
    if (bucket.length) {
      bucket.sort().reverse();
      return bucket[0];
    }
  }
  fail(1, "no Chromium found. Install one with `npx playwright install chromium` " +
    "(or set CHROME_PATH to a chrome/chromium binary).");
}

// ------------------------------------------------------------------- main --
const o = parseArgs(process.argv.slice(2));
const { ext } = validate(o);
const inputAbs = path.resolve(o.input);
const datAbs = o.dat ? path.resolve(o.dat) : null;

const routes = new Map();
// Serve under a basename carrying the normalized extension: the viewer's
// handleFiles dispatches on the URL extension, so "*.oxview.json" must be
// served as "*.oxview" (bytes come from the real path either way).
const servedBase = path.basename(inputAbs).replace(/\.json$/i, "");
routes.set(`/__in__/0/${servedBase}`, inputAbs);
if (datAbs) routes.set(`/__in__/1/${path.basename(datAbs)}`, datAbs);

const srv = serveStatic(REPO_ROOT, routes);
const port = await listen(srv, o.port);

const params = new URLSearchParams();
params.set("f", `/__in__/0/${servedBase}`);
if (datAbs) params.set("g", `/__in__/1/${path.basename(datAbs)}`);
const target = `http://127.0.0.1:${port}/index.html?${params.toString()}`;

const { chromium } = loadPlaywright();
const exe = findChrome();
const pageErrors = [];
const consoleErrors = [];
let browser;
try {
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: o.width, height: o.height } });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.stack || e)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.goto(target, { waitUntil: "load", timeout: o.timeout }).catch((e) => {
    fail(1, `could not load viewer page ${target}: ${e.message}`);
  });

  // 1. Viewer scripts parsed (readiness signal source: handleFiles defined).
  try {
    await page.waitForFunction(() => typeof handleFiles === "function", null, { timeout: o.timeout });
  } catch {
    fail(1, `viewer scripts did not initialise within ${o.timeout} ms. ` +
      `Page errors:\n${pageErrors.join("\n") || "(none)"}`);
  }

  // 2. Structure actually loaded: ≥1 system with monomers.
  try {
    await page.waitForFunction(
      () => typeof systems !== "undefined" && systems.length > 0 &&
        systems[0].getMonomers().length > 0,
      null, { timeout: o.timeout });
  } catch {
    fail(1, `timed out after ${o.timeout} ms waiting for ${inputAbs} to load ` +
      `(no system with nucleotides appeared). ` +
      `Is the file a valid ${ext === "top" ? ".top (+ .dat)" : "." + ext} structure? ` +
      `Page errors:\n${pageErrors.join("\n") || "(none)"}` +
      (consoleErrors.length ? `\nConsole errors:\n${consoleErrors.slice(0, 5).join("\n")}` : ""));
  }

  // 2b. Full-load gate: the loader adds nucleotides progressively, so
  // "≥1 monomer" (step 2) can fire on a partial structure — fitting then
  // would compute a tiny bounding sphere (close-up framing). Wait until
  // the total monomer count stops growing. (Cheap polls, no renders.)
  try {
    await page.waitForFunction(
      () => {
        var n = systems.reduce(function (a, s) { return a + s.getMonomers().length; }, 0);
        var st = window.__oxvrLoad || (window.__oxvrLoad = { n: -1, stable: 0 });
        if (st.n === n) st.stable++;
        else { st.n = n; st.stable = 0; }
        return n > 0 && st.stable >= 4;
        // eslint-disable-next-line no-undef
      },
      null, { timeout: o.timeout, polling: 500 });
  } catch {
    fail(1, `structure kept changing for ${o.timeout} ms waiting for ${inputAbs} to finish loading. ` +
      `Page errors:\n${pageErrors.join("\n") || "(none)"}` +
      (consoleErrors.length ? `\nConsole errors:\n${consoleErrors.slice(0, 5).join("\n")}` : ""));
  }

  // 3. Scene setup: axes/box, selection. (Background/clear-color is applied
  // AFTER the camera fit in step 5, so no racing render can capture a
  // transparent/black frame.)
  const setupNote = await page.evaluate(({ arrows, box, select }) => {
    const notes = [];
    try { setArrowsVisibility(!!arrows); }
    catch (e) { notes.push("arrows: " + e.message); }
    try { if (typeof boxObj !== "undefined" && boxObj) boxObj.visible = !!box; }
    catch (e) { notes.push("box: " + e.message); }
    try {
      if (select === "all") selectAll();
      else if (select && select !== "none") {
        const want = select.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        const sys = systems[0];
        const arr = Array.isArray(sys.strands) ? sys.strands
          : (sys.strands && sys.strands.values ? [...sys.strands.values()] : [...sys.strands]);
        const picked = want.map((i) => arr[i]).filter(Boolean);
        if (!picked.length) notes.push(`select: no strands matched [${select}]`);
        else { clearSelection(); api.selectElements(picked.flatMap((s) => s.getMonomers()), true); }
      }
    } catch (e) { notes.push("select: " + e.message); }
    // No render() here: the fit/background/probe steps below each render,
    // and every render costs seconds under SwiftShader.
    return notes.join("; ");
    // eslint-disable-next-line no-undef
  }, { arrows: o.arrows, box: o.box, select: o.select });
  if (setupNote) process.stderr.write(`oxview-render: setup notes: ${setupNote}\n`);

  // 4-6. Fit camera, apply background, and wait for a stable frame — in a
  // bounded re-fit loop. The viewer's loader can reposition the camera
  // AFTER our fit (timing varies per run); a single one-shot fit + fixed
  // sleep then nondeterministically catches a mid-flight or blank frame.
  // Re-fitting until the settle gate passes makes the result deterministic.
  // Total bounded by --timeout.
  //
  // Performance note: each full render() costs seconds under SwiftShader,
  // so the settle polls below are deliberately cheap (camera pose only, no
  // rendering); a single render + pixel probe runs once the pose is stable.
  const t0 = Date.now();
  let settled = false;
  let attempts = 0;
  while (!settled && Date.now() - t0 < o.timeout) {
    attempts++;
    // 4. Freeze controls damping, then fit camera to structure and rotate.
    // The viewer's rAF loop calls controls.update() continuously, so any
    // residual damping drift would race the fit and produce random zoom.
    // (No render() here — later renders supersede it; renders are slow.)
    await page.evaluate(([rx, ry, rz]) => {
      try {
        controls.staticMoving = true;
        if ("enableDamping" in controls) controls.enableDamping = false;
      } catch (e) { /* controls stay as-is; fit below still applies */ }
      let cx = 0, cy = 0, cz = 0, n = 0, r2 = 0;
      const pts = [];
      for (const sys of systems) {
        for (const m of sys.getMonomers()) {
          const p = m.getPos();
          pts.push(p); cx += p.x; cy += p.y; cz += p.z; n++;
        }
      }
      const c = new THREE.Vector3(cx / n, cy / n, cz / n);
      for (const p of pts) r2 = Math.max(r2, p.distanceToSquared(c));
      const radius = Math.sqrt(r2) || 10;
      const vfov = (camera.fov || 45) * Math.PI / 180;
      const aspect = window.innerWidth / window.innerHeight;
      const eff = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * aspect));
      const dist = (radius / Math.tan(eff / 2)) * 1.25;
      // Fixed canonical view direction (not the loader's leftover camera
      // pose, which varies run to run): mostly-+y 3/4 tilt, so identical
      // commands frame identically. --rotate orbits on top.
      const dir = new THREE.Vector3(0.35, 1, 0.45);
      dir.normalize().applyEuler(new THREE.Euler(
        rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180));
      controls.target.copy(c);
      camera.position.copy(c).addScaledVector(dir, dist);
      camera.near = Math.max(dist / 1000, 0.1);
      camera.far = dist * 100 + radius * 10;
      camera.updateProjectionMatrix();
      controls.update();
      window.__oxvrFit = {
        key: [camera.position.x, camera.position.y, camera.position.z,
          controls.target.x, controls.target.y, controls.target.z].map(function (v) {
            return v.toFixed(4);
          }).join(","),
        count: systems.reduce(function (a, s) { return a + s.getMonomers().length; }, 0),
      };
      // eslint-disable-next-line no-undef
    }, o.rot);

    // 5. Background AFTER the fit (opaque clear so the PNG carries real
    // background pixels; the default clear is transparent).
    await page.evaluate((background) => {
      api.setBackgroundColor(background);
      // Make the WebGL clear color opaque so the captured PNG carries real
      // background pixels (the default clear is transparent; CSS bg alone
      // would leave the PNG alpha channel empty). Headless-only, ephemeral.
      renderer.setClearColor(new THREE.Color(background), 1);
      render();
      // eslint-disable-next-line no-undef
    }, o.background);

    // 6a. Cheap pose-stability gate (no rendering per poll): proceed once
    // camera position + controls target are unchanged for consecutive polls.
    // Reset stability state so the previous attempt's key cannot leak in.
    await page.evaluate(() => {
      window.__oxvrStable = { key: "", n: 0 };
      // eslint-disable-next-line no-undef
    });
    const remaining = o.timeout - (Date.now() - t0);
    if (remaining < 5000) break;
    try {
      await page.waitForFunction((need) => {
        var p = camera.position, t = controls.target;
        var key = [p.x, p.y, p.z, t.x, t.y, t.z].map(function (v) {
          return v.toFixed(4);
        }).join(",");
        var st = window.__oxvrStable || (window.__oxvrStable = { key: "", n: 0 });
        st.n = (st.key === key) ? st.n + 1 : 1;
        st.key = key;
        return st.n >= need;
        // eslint-disable-next-line no-undef
      }, 5, { timeout: Math.min(15000, remaining - 4000), polling: 200 });
    } catch {
      // Camera still moving (e.g. the loader repositioned it after our
      // fit) — loop around and re-fit.
      continue;
    }

    // 6b. Single render + pixel probe + capture: the canvas must carry
    // opaque, non-uniform pixels (background + structure actually drawn).
    // Capturing here (rather than in a separate evaluate) saves a full
    // multi-second SwiftShader render per run. Also verifies the pose and
    // monomer count still match the fit — anything that moved/added
    // anything after our fit (loader camera reset, late nucleotides)
    // invalidates the frame instead of screenshotting a wrong one.
    const shot = await page.evaluate((background) => {
      render();
      var key = [camera.position.x, camera.position.y, camera.position.z,
        controls.target.x, controls.target.y, controls.target.z].map(function (v) {
          return v.toFixed(4);
        }).join(",");
      var count = systems.reduce(function (a, s) { return a + s.getMonomers().length; }, 0);
      var fit = window.__oxvrFit || { key: "", count: -1 };
      var same = (key === fit.key && count === fit.count);
      var bg = new THREE.Color(background);
      var br = Math.round(bg.r * 255), bgg = Math.round(bg.g * 255), bb = Math.round(bg.b * 255);
      var src = document.getElementById("threeCanvas");
      var cv = window.__oxvrProbe || (window.__oxvrProbe = document.createElement("canvas"));
      cv.width = 32; cv.height = 32;
      var ctx = cv.getContext("2d");
      ctx.drawImage(src, 0, 0, 32, 32);
      var d = ctx.getImageData(0, 0, 32, 32).data;
      var opaque = 0, other = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 255) opaque++;
        if (Math.abs(d[i] - br) > 8 || Math.abs(d[i + 1] - bgg) > 8 || Math.abs(d[i + 2] - bb) > 8) other++;
      }
      var ok = same && (opaque === d.length / 4 && other > 10);
      return { same: same, opaque: opaque, total: d.length / 4, other: other,
        url: ok ? src.toDataURL("image/png") : null };
      // eslint-disable-next-line no-undef
    }, o.background);
    if (shot.url) {
      fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
      fs.writeFileSync(path.resolve(o.out), Buffer.from(shot.url.split(",")[1], "base64"));
      settled = true;
    }
    // Else blank/transparent frame, or something moved after our fit
    // (pose/count mismatch) — loop around and re-fit.
  }
  if (!settled) {
    fail(1, `scene did not settle within ${o.timeout} ms after ${attempts} fit attempt(s) ` +
      `(camera kept moving or canvas stayed blank). ` +
      `Page errors:\n${pageErrors.join("\n") || "(none)"}` +
      (consoleErrors.length ? `\nConsole errors:\n${consoleErrors.slice(0, 5).join("\n")}` : ""));
  }
  const bytes = fs.statSync(path.resolve(o.out)).size;
  if (!bytes) fail(1, `screenshot wrote an empty file to ${o.out}.`);
  console.log(`rendered ${o.out} (${o.width}x${o.height}, ${bytes} bytes) from ${inputAbs}`);
} catch (e) {
  fail(1, `render failed: ${(e && e.message) || e}` +
    (pageErrors.length ? `\nPage errors:\n${pageErrors.slice(0, 5).join("\n")}` : ""));
} finally {
  if (browser) await browser.close().catch(() => {});
  srv.close();
}
