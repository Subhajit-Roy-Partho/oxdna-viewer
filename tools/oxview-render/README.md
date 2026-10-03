# oxview-render — headless oxView structure screenshots

Minimal CLI that renders a structure file to PNG through the real viewer
(no engine/WASM/UI changes — it just drives the page headlessly).

## Setup (one time)

```bash
cd tools/oxview-render
npm install        # installs playwright-core only; browsers reuse the
                   # existing ~/.cache/ms-playwright install (or set CHROME_PATH)
```

`node_modules/` is gitignored — never commit it.

## Usage

```bash
node render.mjs --input <file.oxview | file.top> [--dat <file.dat>] --out <img.png> [opts]
```

| Flag | Meaning | Default |
|---|---|---|
| `--input PATH` | structure file (`.oxview`, `.top`, `.pdb/.cif/…`) | required |
| `--dat PATH` | config file for `--input X.top` (else auto-uses sibling `X.dat`) | — |
| `--out PATH` | output PNG | required |
| `--width/--height` | viewport pixels | 1280 / 800 |
| `--rotate x,y,z` | camera orbit ° around structure center | `0,0,0` |
| `--background COLOR` | canvas background CSS color | `#ffffff` |
| `--select SEL` | `none` \| `all` \| strand indices (`0,2`) | `none` |
| `--arrows` | keep coordinate-axis arrows (default: hidden) | off |
| `--box` | show simulation box (default: hidden) | off |
| `--timeout MS` | max ms to wait for structure load | 60000 |
| `--port N` | scratch static-server port (auto-bumps if busy; never 5173) | 8903 |

Exit codes: `0` ok · `2` usage/input error · `1` load/render failure
(every failure prints an actionable message to stderr).

## Examples

```bash
# .oxview single file
node render.mjs --input ../../examples/2-free-form_design_example-tetrahedron/tetra.oxview \
  --out /tmp/tetra.png --width 800 --height 600

# .top + .dat (sibling .dat auto-detected; or pass --dat explicitly)
node render.mjs --input ../../examples/2-free-form_design_example-tetrahedron/tetra.top \
  --out /tmp/tetra-topdat.png --width 1024 --height 768 \
  --rotate 30,45,0 --background '#eef2ff'

# equilibrium-PDB-converted structures (the sibling lane's .oxview output)
node render.mjs --input /path/to/relaxed.oxview --out /tmp/relaxed.png
```

## How it works

1. Serves the repo root statically on `127.0.0.1:<port>` (+ `/__in__/...`
   routes exposing just the input files — inputs can live anywhere).
2. Opens `index.html?f=<input>[&g=<dat>]`, reusing the viewer's own
   URL-param loader (`readFilesFromURLParams → handleFiles`), so file
   dispatch is identical to drag-and-drop in the UI.
3. Waits for the explicit readiness signal (≥1 system with nucleotides,
   then monomer count stable across polls so progressive loading can't
   cause a partial-structure fit; bounded by `--timeout`, non-zero exit +
   stderr on failure).
4. Hides axis arrows (unless `--arrows`), freezes controls damping, fits
   the camera to the structure's bounding sphere from a fixed canonical
   direction (identical commands frame identically), applies `--rotate`,
   then sets the background (opaque WebGL clear color), waits for a
   stable frame (settled camera + non-blank canvas, pose/count
   re-verified at capture; re-fits instead of screenshotting a wrong
   frame), and captures the WebGL canvas via `toDataURL` (pure canvas
   pixels — no UI chrome). WebGL runs on SwiftShader; no GPU needed.
   Chromium picker prefers full Chromium builds (headless-shell has no
   WebGL); `CHROME_PATH` overrides, system browsers are fallback.
