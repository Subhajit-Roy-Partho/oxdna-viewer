# WebAssembly builds in this repository

| Module | Files | Source | Engine commit(s) | Built |
|---|---|---|---|---|
| rigidDNA2 | `wasm/rigiddna2/rd2_{mt,st}.{js,wasm}` | `rigidDNA2/wasm` of `Subhajit-Roy-Partho/rigidDNA`, branch `main` | `origin/main` `052b4e24`. Its C++ sources (`src/`, `include/`, `apps/`, `wasm/`, `results/`) are identical to `2ecfe74a` (ring route: backbone cables for wrap links), the commit of the previous build; `052b4e24` adds Python sequence-only tools only. The rebuilt `.wasm` and `.js` files are byte-identical to the previous ones (same SHA-256), the build is reproducible. | 2026-11-04 |
| rigidRNA | `wasm/rigidrna/rd2rna_{mt,st}.{js,wasm}`, `rd2rna_api.js`, `rd2rna_worker.js` | `wasm/` of `Subhajit-Roy-Partho/rigidDNA`, branch `rna-wasm` | `origin/rna-wasm` `ec4a371b` = `origin/rna` `06c01c51` (the rigidRNA line merged with the rigidDNA2 fork line) plus the rigidRNA commit `e943b24c` (also on the remote as `rna-cpp-wasm`: C++ PDB / mmCIF front end, portable RNG, the NaN fix for loop-rich RNAs such as the 402-nt Hol_OG, and the `fold` / `substruct` / `pdb2rna` / `oxrna2pdb` entry points) plus one line in `wasm/CMakeLists.txt` that excludes `src/run_process.cpp`. The C++ sources are identical to those of the previous build (`origin/rna` `8bd12958`); the rebuilt files are byte-identical to the ones in this repository (same SHA-256). | 2026-11-04 |

| seqpred | `wasm/seqpred/seqpred_{mt,st}.{js,wasm}`, `seqpred_api.js`, `seqpred_api.d.ts`, `seqpred_worker.js`, `build.json` | `wasm/seqpred/` of `Subhajit-Roy-Partho/rigidDNA2`, branch `cpp-5` commit `06ee5010` (models v2 v3 v4 m2 h2d ml2 ms2 ms3 nat1 e1 ml4 domainB hybridB nested, **auto** = the ROUTE-1 router, `score` utility; [ml3 is native only: pKiss is GPL-3]; sources `src/seqpred`, `include/seqpred`; ViennaRNA 2.7.2 libRNA compiled with it) | see `build.json` (`engine`) and `docs/99_cpp4.md`, `docs/105_cpp5.md`, `docs/70_seqpred_cpp.md` of that branch for commit, Docker image (`emscripten/emsdk:6.0.13`), flags, sha256 and the byte-identical rebuild | 2026-11-09 (build 734a40e80f05, seqpred 06ee5010; sha256 `seqpred_st.wasm` 6cd4cb7c0b95b64b..., `seqpred_mt.wasm` 1805f54407555a09..., `seqpred_st.js` 41b4a46f..., `seqpred_mt.js` 96e60900..., two independent Docker builds byte-identical, 4 of 4 files; `seqpred_st.wasm` 6,612,029 bytes, 2.88 MB gzip) |

`origin/rna` alone cannot be used as the source of the WebAssembly (use the branch `rna-wasm`, which is `origin/rna` plus the two changes below; the commands that follow record how it was made): its `wasm/CMakeLists.txt` compiles every `src/*.cpp`, and `src/run_process.cpp` (fork-line subprocess
driver, `fork()` and `<sys/prctl.h>`) does not compile with Emscripten; and it does not contain `e943b24c` (Hol_OG would export NaN positions again, no PDB / mmCIF input,
no sequence-only entry in the JS API). The build therefore used:

```
git merge --no-commit e943b24c        # conflicts only in .gitignore, scripts/site/build_site.py, scripts/site/home.py (kept the origin/rna side; not part of the build)
# wasm/CMakeLists.txt, after file(GLOB RD2_SRC ${TOP}/src/*.cpp):
list(FILTER RD2_SRC EXCLUDE REGEX "/run_process\\.cpp$")
```

## Toolchain and flags (both modules, as in the previous builds)

* Emscripten 6.0.13 (`e13ee988ce3d`), the Docker image `emscripten/emsdk:6.0.13`; CMake and Ninja (conda `ninja` 1.13.2 mounted into the container), Eigen 3.4.0 and nlohmann-json from the conda include directory.
* `wasm/build.sh <build dir> <deploy dir>` of the engine, `RD2_JOBS=4`: `emcmake cmake -S wasm -B <build>/{mt,st} -G Ninja -DRD2_WASM_THREADS={ON,OFF}`, build type Release.
* Compile flags: `-O3 -DNDEBUG -fwasm-exceptions -msimd128`, and for `mt` also `-pthread -fopenmp`; `RD2_WASM_MAX_THREADS=8`.
* Link flags: `-sMODULARIZE=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=8MB -sINITIAL_MEMORY=256MB` (rigidDNA2) or `128MB` (rigidRNA),
  `-sNO_EXIT_RUNTIME=1 -sINVOKE_RUN=0 -sFILESYSTEM=1`, the parameter and template files embedded with `--embed-file`; `mt`: `-pthread -fopenmp -sPTHREAD_POOL_SIZE=min(cores, 8)-1 -sDEFAULT_PTHREAD_STACK_SIZE=2MB`.
* The multi-thread builds need cross-origin isolation (see `README-web.md`); nothing changed there.

## seqpred (sequence -> secondary structure)

A separate module (not part of the rigidRNA engine): the rigidRNA tab's input "Sequence only: predict with seqpred" calls `wasm/seqpred/seqpred_worker.js` (class `SeqpredEngine`, `ts/editing/seqpred_bridge.ts`), writes the predicted dot-bracket into the dot-bracket field and the summary names the build id. `wasm/seqpred/build.json` is written by `tools/rd2wasm-e2e/stamp_seqpred_build.mjs` (hash of the two `.wasm` files); the files are requested as `...?v=<build>`. Methods (rigidDNA2 branch `seqpred-cpp2`, `docs/70_seqpred_cpp.md` section 13): `v2` (default), `v3` (v2 + closing-helix candidates, PK-7), `msrna` (several RNA strands separated by `&`: MS-RNA v4 with its alternative states), `dna` (several DNA strands separated by `&`: domain pairing + ViennaRNA-DNA MFE hybrid) and `ssdna` (one DNA strand: hybrid, MFE, G-quadruplex / i-motif rules); the DNA methods are prediction only (the rigidRNA engine builds RNA). Parity with the Python reference, measured on golden cases (native and this WebAssembly build, exact pair sets, energies to 1e-9): v3 47 of 47 (up to 200 nt), MS-RNA 45 of 45, DNA hybrid 27 of 27, single-strand DNA 28 of 28. Not in the module: NUPACK (proprietary), the scaffold-alignment / species-collapse steps of the multi-strand DNA lane, `pk_ml`, `kl_strain`, `kl_energy`, the DNA material switch of `longrange`. Checks: `node tools/rd2wasm-e2e/seqpred.mjs --out <prefix>` and `node tools/rd2wasm-e2e/seqpred_modes.mjs --out <prefix>` (v3, MS-RNA, DNA; expected structures are those of the Python references). Earlier check: `node tools/rd2wasm-e2e/seqpred.mjs --out <prefix>` (headless Chromium: predicts a 181-nt designed kissing-loop RNA, checks the `[ ]` layer, the build id in the URLs and the summary, builds it through the rigidRNA run). Licence note: the module contains ViennaRNA 2.7.2 code (free for research and commercial use, not to be redistributed for a fee, credit required: the summary and the tab text give it).

Models (via `options.model`, the model select of the tab, or the method for the single-chain ones: `version.models` lists what the build carries with a one-line trade-off; anything missing from the object is disabled as "not in this build"): `v2` (default), `v3` (closing-helix candidates), `m2` (EXPERIMENTAL re-ranker: raises pseudoknot F1 on natural RNAs but adds false helices on random sequences). Newer builds add `v4` (short-helix rule + confidence status), `h2d` (2D refit, EXPERIMENTAL), `ml2`/`ml3` (do-no-harm re-rankers; ml3 needs pKiss, the browser module does not carry it (GPL-licensed external program, not compiled in; no model without that input is shipped)) and `ms2` (multi-strand RNA/DNA, strands separated by `&`); the tab feature-detects all of them (see `docs/SEQPRED_USER_GUIDE.md` for the honest per-model numbers). The result carries a `selection` block (top candidates with pairs / layers / score / label / flags, `selection.route`, `selection.gate.kind` = `margin` | `discriminator` | `none`, the nested-MFE decoy) that draws the arc diagram and the ranked-candidate chart, a `confidence` block (status `designed-kissing` | `low-confidence` | `nested` | `extra-helices` | `fallback-nested`, margins, per-helix rules) that colours the summary, and `loadSeconds` (page-measured module loading time) next to the engine seconds. The request options `gateMargin` (m2, h2d), `thr` (ml2, ml3), and the ms2-only `molecule` / `temp` / `declaredAssembly` / `kissPrior` / `g4` / `msdna` are passed through; `budgetSeconds` bounds every stage (result then has `truncated: true` and `timings.truncatedAt`). Checks: `tools/rd2wasm-e2e/seqpred_sel.mjs` (model selector, per-model runs on a 181-nt design and a 76-nt tRNA with SKIPs for models missing from the build, selection panel, reference overlay, downloads, screenshots), `tools/rd2wasm-e2e/seqpred_renderer.mjs` (offline RENDERER CHECK of the new summary fields and downloads from hand-written results, no model run), `seqpred.mjs`, `seqpred_modes.mjs` (ms2 disabled/SKIPPED while not in the build).

## Files that are not engine output

`wasm/rigiddna2/rd2_api.js` and `rd2_worker.js` carry viewer changes (gap-linker option, build id on the URLs) and are not overwritten by `wasm/build.sh`; `wasm/rigiddna2/build.json` is written by
`tools/rd2wasm-e2e/stamp_build.mjs` (the id is the hash of the two `.wasm` files). `wasm/rigidrna/rd2rna_api.js` and `rd2rna_worker.js` are the engine's files.

## Checks

`tools/rd2wasm-e2e/`: `tabs.mjs` (tabs), `e2e.mjs` (a design through the rigidDNA2 tab to the scene, screenshots), `advanced.mjs` (rigidDNA2 advanced fields), `rigidrna.mjs` and `rnamodes.mjs` (rigidRNA tab).
The engine's own node tests (`rigidDNA2/wasm/tests/test_wasm.cjs`, `wasm/tests/test_wasm.cjs` of the rigidRNA branch) run against the modules in this repository.

## seqpred checks (all need only this repository and headless Chromium; the build id placeholder `<set by stamp_seqpred_build.mjs>` is the hash of the two `.wasm` files)

```
node tools/rd2wasm-e2e/seqpred.mjs --out <prefix>               # 181-nt design, build id, rigidRNA run
node tools/rd2wasm-e2e/seqpred_modes.mjs --out <prefix>        # v3, MS-RNA, DNA, ssDNA (+ ms2 SKIP)
node tools/rd2wasm-e2e/seqpred_sel.mjs --out <prefix>          # model selector, per-model runs, selection panel, downloads, screenshots
node tools/rd2wasm-e2e/seqpred_renderer.mjs --out <prefix>     # offline RENDERER CHECK, no model run
node tools/rd2wasm-e2e/seqpred_cpp4.mjs --out <prefix>         # NAT-1, ENERGY-1 (K 30 / 50), ML-4, MS-3, domain pairing B, hybrid B, reference scoring, desktop + phone screenshots
node tools/rd2wasm-e2e/seqpred_cpp5.mjs --out <prefix>         # auto router: default, labels, arm / reason / mlFallback rows, pair sets of the Python router (ML3 disabled), desktop + phone screenshots
```
`seqpred_sel.mjs` runs every model the loaded build offers on the 181-nt designed kissing RNA
and a 76-nt natural tRNA and checks the new summary fields (model, predictor score, margin to
the nested decoy, gate line, confidence, engine + loading times, version line) and the
download builders; models missing from the build are reported as SKIPPED. Keep the whole
suite under ~15 min (use `budgetSeconds` for the long runs). Screenshots go wherever `--out`
points (desktop light, dark via `emulateMedia`, phone 390 px); open and read every screenshot
before reporting. User guide: `docs/SEQPRED_USER_GUIDE.md`.

## seqpred package: licences, data provenance and reproducibility (CPP-4 / CPP-5, 2026-11-09)

* **Code licences inside `seqpred_{st,mt}.wasm`.** ViennaRNA 2.7.2 (libRNA, compiled with Emscripten; free for research and commercial use, not to be redistributed for a fee, credit required: the tab shows it); the seqpred C++ sources are the project's own; nlohmann/json (MIT) is a header-only dependency. **pKiss (GPL-3.0-or-later) is NOT included, copied or ported**: it cannot be combined with ViennaRNA in one binary, so ML3 (which needs it) stays native-only and the `auto` router reports `mlFallback: true` when its ML3 line is unavailable. No third-party model weights are shipped.
* **Learned data embedded in the module.** NAT-1 (11 + 10 weights), ENERGY-1 (two weight files), the ML-4 HG-Net ensemble (5 x 75,475 float32, 1.5 MB), the LightGBM re-rankers ML2 / M2 / H2D and the router's confidence table (`route_confidence.json`, cell means) are the project's own fits on the development splits of one benchmark pool built from public data (structures annotated from deposited PDB coordinates, the comparative structures of bpRNA-1m(90), ArchiveII and Rfam seed projections, and designed sequences with their intended pairing; the split unit is a family: 50 %-identity MMseqs2 clusters united with Rfam families; the sealed test splits were never used in a fit). They are not weights of any third-party model.
* **Reproducibility.** Docker `emscripten/emsdk:6.0.13`, recipe `wasm/seqpred/build.sh` of the source repository, two independent builds (separate output and Emscripten cache directories) are byte-identical (4 of 4 files, sha256 above); `build.json` is the hash of the two `.wasm` files.
* **Equivalence with the Python references** (what was compared and the counts) is in `docs/99_cpp4.md` and `docs/105_cpp5.md` of the source repository; the checks that need only this repository are the `seqpred*.mjs` scripts above.
