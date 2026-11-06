# WebAssembly builds in this repository

| Module | Files | Source | Engine commit(s) | Built |
|---|---|---|---|---|
| rigidDNA2 | `wasm/rigiddna2/rd2_{mt,st}.{js,wasm}` | `rigidDNA2/wasm` of `Subhajit-Roy-Partho/rigidDNA`, branch `main` | `origin/main` `052b4e24`. Its C++ sources (`src/`, `include/`, `apps/`, `wasm/`, `results/`) are identical to `2ecfe74a` (ring route: backbone cables for wrap links), the commit of the previous build; `052b4e24` adds Python sequence-only tools only. The rebuilt `.wasm` and `.js` files are byte-identical to the previous ones (same SHA-256), the build is reproducible. | 2026-11-04 |
| rigidRNA | `wasm/rigidrna/rd2rna_{mt,st}.{js,wasm}`, `rd2rna_api.js`, `rd2rna_worker.js` | `wasm/` of `Subhajit-Roy-Partho/rigidDNA`, branch `rna-wasm` | `origin/rna-wasm` `ec4a371b` = `origin/rna` `06c01c51` (the rigidRNA line merged with the rigidDNA2 fork line) plus the rigidRNA commit `e943b24c` (also on the remote as `rna-cpp-wasm`: C++ PDB / mmCIF front end, portable RNG, the NaN fix for loop-rich RNAs such as the 402-nt Hol_OG, and the `fold` / `substruct` / `pdb2rna` / `oxrna2pdb` entry points) plus one line in `wasm/CMakeLists.txt` that excludes `src/run_process.cpp`. The C++ sources are identical to those of the previous build (`origin/rna` `8bd12958`); the rebuilt files are byte-identical to the ones in this repository (same SHA-256). | 2026-11-04 |

| seqpred | `wasm/seqpred/seqpred_{mt,st}.{js,wasm}`, `seqpred_api.js`, `seqpred_worker.js`, `build.json` | `wasm/seqpred/` of `Subhajit-Roy-Partho/rigidDNA`, branch `m2-port` (rebuild of `seqpred-cpp2` with the M2 re-ranker; sources `src/seqpred`, `include/seqpred`; ViennaRNA 2.7.2 libRNA compiled with it) | see `build.json` (`engine`) and `docs/70_seqpred_cpp.md` of that branch for commit, Docker image digest, flags, sha256 and the byte-identical rebuild | 2026-11-06 (build 29b2ca3bc219, seqpred 2b071704) |

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

Models (`options.model` or the model select of the tab): `v2` (default), `v3` (closing-helix candidates) and `m2` (EXPERIMENTAL re-ranker: raises pseudoknot F1 on natural RNAs but adds false helices on random sequences; see the tooltip text). The tab enables M2 only when the module's version block lists it. The result carries a `selection` block (top 20 candidates with layers and scores, the nested-MFE decoy, the gate decision) that draws the arc diagram and the ranked-candidate chart. Checks: `tools/rd2wasm-e2e/seqpred_sel.mjs` (model selector, selection panel, reference overlay, M2 run), `seqpred.mjs`, `seqpred_modes.mjs`.

## Files that are not engine output

`wasm/rigiddna2/rd2_api.js` and `rd2_worker.js` carry viewer changes (gap-linker option, build id on the URLs) and are not overwritten by `wasm/build.sh`; `wasm/rigiddna2/build.json` is written by
`tools/rd2wasm-e2e/stamp_build.mjs` (the id is the hash of the two `.wasm` files). `wasm/rigidrna/rd2rna_api.js` and `rd2rna_worker.js` are the engine's files.

## Checks

`tools/rd2wasm-e2e/`: `tabs.mjs` (tabs), `e2e.mjs` (a design through the rigidDNA2 tab to the scene, screenshots), `advanced.mjs` (rigidDNA2 advanced fields), `rigidrna.mjs` and `rnamodes.mjs` (rigidRNA tab).
The engine's own node tests (`rigidDNA2/wasm/tests/test_wasm.cjs`, `wasm/tests/test_wasm.cjs` of the rigidRNA branch) run against the modules in this repository.
