# Running oxdna-viewer as a Web App

No Electron required. Just serve the directory:

```bash
# Option 1: use the provided script
./web-serve.sh

# Option 2: npm
npm run serve

# Option 3: Python
python3 -m http.server 8766
```

Then open http://localhost:8766 in your browser.

## Integration with NanoCanvas
Open the integration page: http://localhost:8766/integration/nanocanvas_embed.html
(Start NanoCanvas on port 5173 and the NanoCanvas backend on port 8765 first)

## rigidDNA2 in the browser (WebAssembly)

The **rigidDNA2** ribbon button (or dropping a caDNAno `.json` / scadnano `.sc` file on the page) opens a window that computes the relaxed 3D structure of a
design in your browser and loads it as a normal system: rigidDNA2 (coarse rigid-body relaxation, nucleotide export, native oxDNA2 relaxation, safety gate)
compiled to WebAssembly in `wasm/rigiddna2/`, run in a Web Worker with a progress bar and a Cancel button. Built from `rigidDNA2/wasm` of the rigidDNA
repository (`wasm/build.sh <build dir> <this repo>/wasm/rigiddna2`; see `rigidDNA2/docs/26_webassembly.md` there).

**Gap-linker nucleotides.** On the lattice route the engine can splice poly-T nucleotides into strands to bridge long gaps between helix ends, which makes the exported file longer than the design. The *Gap-linker nucleotides* option of the window (auto, none, allow) controls this: auto means none for a scadnano `.sc` design, whose strands are what the user wrote, and the engine's default (added when needed) for caDNAno designs. The result table shows how many were added.

**Multi-core needs cross-origin isolation** (SharedArrayBuffer): the server must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`). `./web-serve.sh` does this through `serve.json`. With any other server (`python3 -m http.server`,
a static host) add the two headers there; without them the window uses the single-thread build, and offers "Enable multi-core via service worker", which registers
`coi-serviceworker.js` (adds the headers client-side, reloads the page once). Safari has no `credentialless`: single-thread only.

End-to-end check in a headless Chromium: `node tools/rd2wasm-e2e/e2e.mjs --design design.json --out /path/prefix --threads 4` (writes screenshots and a JSON record;
needs playwright-core as in `tools/oxview-render`).
