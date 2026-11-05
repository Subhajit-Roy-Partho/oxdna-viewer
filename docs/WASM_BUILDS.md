# WebAssembly builds in this repository

| Module | Files | Source | Engine commit(s) | Built |
|---|---|---|---|---|
| rigidDNA2 | `wasm/rigiddna2/rd2_{mt,st}.{js,wasm}` | `rigidDNA2/wasm` of `Subhajit-Roy-Partho/rigidDNA`, branch `main` | `origin/main` `052b4e24`. Its C++ sources (`src/`, `include/`, `apps/`, `wasm/`, `results/`) are identical to `2ecfe74a` (ring route: backbone cables for wrap links), the commit of the previous build; `052b4e24` adds Python sequence-only tools only. The rebuilt `.wasm` and `.js` files are byte-identical to the previous ones (same SHA-256), the build is reproducible. | 2026-11-04 |
| rigidRNA | `wasm/rigidrna/rd2rna_{mt,st}.{js,wasm}`, `rd2rna_api.js`, `rd2rna_worker.js` | `wasm/` of the same repository, branch `rna` | `origin/rna` `8bd12958` (the rigidRNA line merged with the rigidDNA2 fork line) **plus the rigidRNA commit `e943b24c`** (local branch `cpp-wasm`, not on the remote: C++ PDB / mmCIF front end, portable RNG, the NaN fix for loop-rich RNAs such as the 402-nt Hol_OG, and the `fold` / `substruct` / `pdb2rna` / `oxrna2pdb` entry points of the module), merged without a commit in a scratch worktree; **plus one line in `wasm/CMakeLists.txt`** (below). | 2026-11-04 |

`origin/rna` alone cannot be used as the source of the WebAssembly: its `wasm/CMakeLists.txt` compiles every `src/*.cpp`, and `src/run_process.cpp` (fork-line subprocess
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

## Files that are not engine output

`wasm/rigiddna2/rd2_api.js` and `rd2_worker.js` carry viewer changes (gap-linker option, build id on the URLs) and are not overwritten by `wasm/build.sh`; `wasm/rigiddna2/build.json` is written by
`tools/rd2wasm-e2e/stamp_build.mjs` (the id is the hash of the two `.wasm` files). `wasm/rigidrna/rd2rna_api.js` and `rd2rna_worker.js` are the engine's files.

## Checks

`tools/rd2wasm-e2e/`: `tabs.mjs` (tabs), `e2e.mjs` (a design through the rigidDNA2 tab to the scene, screenshots), `advanced.mjs` (rigidDNA2 advanced fields), `rigidrna.mjs` and `rnamodes.mjs` (rigidRNA tab).
The engine's own node tests (`rigidDNA2/wasm/tests/test_wasm.cjs`, `wasm/tests/test_wasm.cjs` of the rigidRNA branch) run against the modules in this repository.
