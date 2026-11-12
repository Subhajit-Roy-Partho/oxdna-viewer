# rigidDNA2 tab: the options of `rd2_run` in the browser

The rigidDNA2 tab of the rigidDNA window runs `rd2_run` of the rigidDNA engine compiled to WebAssembly (`wasm/rigiddna2/`, built from the engine's `origin/main` at `052b4e24`,
`rigidDNA2/wasm/build.sh`; engine commits and build flags in `docs/WASM_BUILDS.md`). A run in the browser is the command line `rd2_run <design> <out_prefix> [options]` on an in-memory file system. This page lists every
option of that command line, says which ones the tab exposes (section **Advanced properties** of the tab), which ones cannot work in a browser and why, and how the
command line is made, so that the GUI and the command line stay the same thing.

## How the tab makes the command line

* **Basic options** (block "2. Options"): layout route (`--route`), infer staples (`--infer-staples`), gap-linker nucleotides (`--no-linkers`; auto = none for a scadnano design),
  native oxDNA2 relaxation (`--no-native` when off), threads (`--threads`). They are fields of `Rd2Options` (`ts/editing/rigiddna2_bridge.ts`).
* **Advanced properties** (collapsible section, closed by default, 12 groups): one typed field per option in the table `RD2_OPTS` of `ts/editing/rigiddna2_ui.ts`. A **blank field passes nothing**,
  so the engine's own default applies. A field that fails its check (not a number, not a whole number, outside the allowed range, a bad list entry, a half-filled pair) is marked red with the reason,
  counted in the section heading, and **not passed**. **Reset advanced** blanks every field. Pairs of options whose combination the engine resolves in a way one may not expect
  (for example `--no-exc` with `--exc`) are both passed as typed and the first shows a note on what the engine does.
* **Command line preview**: the arguments are produced by `Rd2Api.buildArgs` of `wasm/rigiddna2/rd2_api.js`, the very function the worker runs (the page loads that script too,
  `Rd2Engine.loadApi`), from the very options object of the run. The same line is written as the first line of the log (`$ rd2_run ...`) when a run starts. In the browser the files are
  `/work/design.<ext>` and `/work/out`; the preview shows the real file names, which is what the same command line needs natively.
* The engine's own parsers (`apps/rd2_run.cpp`, `src/pipeline.cpp`, `src/relax.cpp`) read numbers with `atoi` / `atof` and skip an option they do not know without a message (a typo or
  `--orient-search abc` silently becomes 0). The tab therefore checks the values itself before they reach the engine.
* `--prepare-only` and `--route-only` (group "Diagnostics and output", "Stop early") produce no structure: the tab says so and leaves the log with the route lines.

Tests: `tools/rd2wasm-e2e/advanced.mjs` (headless Chromium, real window: closed/open, one control per option, validation, Reset, and runs whose arguments are captured inside the worker and
compared with the preview).

## Basic options (block "2. Options")

| Option | Values | Engine default | In the browser |
|---|---|---|---|
| `--route` | auto, lattice, wireframe, articulated, ring | auto (decided from the design; route and reason are in the summary) | route select |
| `--infer-staples` | auto, on, off | auto | infer staples select |
| `--no-linkers` | switch | linkers on (the tab: auto = off for scadnano) | gap-linker select |
| `--no-native` | switch | native relaxation on | checkbox |
| `--threads` | 1..min(cores, 8) | 8 or fewer natively | threads field (single-thread build: 1) |

## Options in the Advanced properties section

Each group below is a group of the Advanced properties section; `docs/NN` refers to the engine docs (`rigidDNA2/docs/` of the engine repository). A blank field passes nothing. "Bridge" says how the option reaches `rd2_run`: `extra` = the `extra` array of `Rd2Options` (verbatim arguments appended by `Rd2Api.buildArgs`), or the first-class field of `Rd2Options` that `buildArgs` turns into the same flag.

### Route and layout

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--lattice` | choice | square \| honeycomb | auto | square or honeycomb helix packing; auto: the file's own grid/tag, else detected from the crossovers | rd2_run header | `lattice` field |
| `--wireframe` | choice | on \| off | auto | free-form wireframe designs (no lattice-neighbour crossovers, crossovers at helix ends): layout from the junction graph, no gap linkers | rd2_run header | `extra` |
| `--phase-embed` | choice | on \| off | auto | helix axes from the phase of the crossovers when the lattice cells of a caDNAno design contradict them (flat sheet drawn as a compact serpentine, docs/35) | rd2_run header | `extra` |
| `--bundle-layout` | choice | on \| off | auto | bundles as the edges of a polyhedron or mesh (icosahedron, 4-helix-bundle meshes): the articulated route starts from a graph embedding of the bundles (docs/27) | rd2_run header | `extra` |
| `--articulated` | choice | on \| off | auto | many bundles joined by long-range crossovers (Trifolium): relocation route without gap linkers and lattice start | rd2_run header | `extra` |
| `--articulated-min-bodies` | integer | 1..100000 | 8 | auto route: fewest substructures for the articulated rule | rd2_run header | `extra` |
| `--start` | choice | ideal \| lattice | ideal | ideal: ideal helix geometry of the design (no relocation); lattice: the lattice start | prepare.h (idealStart) | `extra` |
| `--staple-length` | integer | 1..1000 | 32 | length of the inferred staples (nucleotides, at most); used when "Infer staples" adds staples | rd2_run header | `extra` |
| `--keep-wrap-links` | switch | - | off | keep backbone links from the end of a helix to its start inside a rigid stack that cannot close into a ring (default: cut, docs/26) | rd2_run header | `extra` |
| `--plane-k` | number | 0..1000 | auto | wall k/2 (n.p - q)^2 around the plane of a flat layout during the coarse relaxation (docs/30); default 0.0003 when the layout is flat, 0 = off | rd2_run header | `extra` |
| `--plane-flat` | number | 0..1 | 0.15 | the start layout counts as flat when its thin axis rms is below this fraction of its middle axis rms | relax.h | `extra` |

### Ring designs (beachball)

Three 6-helix-bundle rings joined at two places each (the Dietz et al. 2009 beachball, database 446, `examples/beachball/beachball.json`) are laid out as a ball of rings; other multi-ring designs are laid out the older way. The bundled reviewed reference (`beachball_reviewed.top`/`.dat`, run 3262 of the fork's Python route, repaired, zero bonds outside FENE) has compressed rings (radius about 17 nm, Rg 18.2 nm); the engine computes three round interlocking rings (radius about 22 nm, Rg about 22.9 nm). The two are **not identical** (Chamfer distance 4.4-4.6 nm). There is no dedicated switch for the beachball layout in this build.

### Relocation of the bodies

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--no-reloc` | switch | - | off | skip the relocation step | rd2_relax header | `extra` |
| `--dist` | choice | 0 \| 1 \| 2 | 2 | distance model of the relocation: 0 paper, 1 pair-diagonal, 2 bond-based | relax.cpp (RelocOptions) | `extra` |
| `--restarts` | integer | 0..10000 | 0 | random restarts of the relocation (planar and free 3D) | relax.cpp (RelocOptions) | `extra` |
| `--no-planar` | switch | - | off | free 3D relocation instead of the planar one (docs/25) | docs/25 | `extra` |
| `--no-ring-layout` | switch | - | off | skip the polygon layout of a cycle of bundles (docs/25) | relax.h, docs/25 | `extra` |
| `--no-bar-loop` | switch | - | off | switch the loop-of-bars layout off (docs/31) | docs/31 | `extra` |
| `--row-sign` | choice | -1 \| 0 \| 1 | 0 | 0: choose by crossover fit, +1/-1: force the sign of the row axis (lattice handedness) | model.h | `extra` |

### Orientation search

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--orient-search` | integer | 0..100000 | off | free SO(3) orientation search of the rigid bundles (N random starts, 6 DOF per bundle) before the relaxation, for designs whose bundles must cross or tilt (docs/15); where the lattice cannot give the pose of a few bodies the front end switches it on by itself (docs/32) | rd2_relax header, docs/15, rd2_run | `extra` |
| `--orient-seed` | integer | 0..2147483647 | 1 | random seed of the orientation search | rd2_relax header | `extra` |
| `--orient-fast` | switch | - | on in the tab (engine default: off) | with a number of starts: v2 search (cell-list repulsion, screened starts), best minimum only (docs/17). The box starts ticked; the tab passes the flag only together with explicit `--orient-search N` (N > 0): the engine's own automatic body-pose search (docs/32) is anchored and ranks slot candidates, which the v2 search does not do, so it keeps the v1 path. Untick the box for the v1 search. "Reset advanced" ticks it again | rd2_relax header, docs/17 | `extra` |
| `--orient-keep` | integer | 0..1000 | 0 | v2 search keeping K distinct body-level minima, ranked on the rigid-segment path (needs --from-poses, which the browser cannot give: then the ranking is skipped); implies --multilevel (docs/17) | rd2_relax header, docs/17 | `extra` |
| `--orient-screen` | two integers | 0..100000 | 30, max(40, starts/6) | IT KEEP of the v2 search: iterations of the screening and number of screened starts kept (IT <= 0 / KEEP 0: the defaults) | relax.h | `extra` |
| `--orient-round` | switch | - | off | only round candidates compete in the ranking (docs/17) | rd2_relax header | `extra` |
| `--orient-probe` | integer | 1..100000 | 40 | node-level iterations of the candidate ranking | relax.h | `extra` |

### Coarse relaxation

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--dmin` | number | 0.1..20 | 3.0 on the lattice route, 2.8 on every other route | helix-axis repulsion distance (oxDNA length units); an explicit value is used on every route (the library default stays 2.8, `rd2_run` applies 3.0 when the route is the lattice route and `--dmin` was not given) | apps/rd2_run.cpp, model.h, relax.h | `extra` |
| `--krep` | number | 0..100000 | 5 | stiffness of the helix-axis repulsion | model.h, relax.h | `extra` |
| `--iters` | integer | 1..100000 | 400 | Levenberg-Marquardt iterations per continuation stage | relax.h | `extra` |
| `--stages` | integer | 1..1000 | auto | continuation stages of the node level (default: automatic) | relax.h | `extra` |
| `--no-multilevel` | switch | - | off | plain five-stage coarse relaxation instead of the three-layer cascade (rd2_run uses --multilevel by default) | rd2_pipeline header | `extra` |
| `--multilevel` | switch | - | on | coarse-to-fine hierarchy (docs/10): rigid helix segments are optimised before the node-level relaxation; already the default of rd2_run | rd2_relax header, docs/10 | `extra` |
| `--legacy` | switch | - | off | one switch back to the previous algorithm: same as --no-exc, ignores --subho and --multilevel, results equal the pre-subhoTropy code exactly (docs/11) | rd2_relax header | `extra` |

### Excluded volume and subhoTropy

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--exc` | number | 0..1000 | 1 | nucleotide excluded volume (oxDNA backbone/base site potential) scaled by S between the nucleotides of different base-pair nodes; 0 = off (docs/09) | rd2_relax header, docs/09 | `extra` |
| `--no-exc` | switch | - | off | switch the nucleotide excluded volume off (same as --exc 0): the previous model and results exactly | rd2_relax header | `extra` |
| `--exc-stages` | integer | 1..1000 | 2 | apply it in the last K dmin stages only (the early stages start from overlapping sheets) | rd2_relax header | `extra` |
| `--subho` | number | 0..100000 | 0 (off) | maximum-entropy spreading term -L*mean ln(bead distance) added to the energy; an energy, 0 = off (docs/08) | rd2_relax header, docs/08 | `extra` |
| `--subho-bead` | integer | 1..100000 | 32 | base pairs per bead of the spreading term | rd2_relax header | `extra` |
| `--subho-scope` | choice | 0 \| 1 \| 2 | 0 | 0 pairs not on one helix, 1 pairs of different substructures, 2 all pairs | rd2_relax header | `extra` |
| `--subho-dsat` | number | 0.1..100000 | 80 | ln d is continued linearly beyond D | rd2_relax header | `extra` |
| `--subho-ramp` | integer | 1..1000 | 1 | the strength ramps up over K stages | rd2_relax header | `extra` |
| `--subho-release` | integer | 0..1000 | 0 | the term is switched off for the last K continuation stages: spread first, then relax to the model minimum | rd2_relax header | `extra` |

### Multilevel cascade

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--ml-stages` | integer | 1..1000 | 1 | fine dmin stages after the segment cascade | rd2_relax header | `extra` |
| `--ml-cut` | integer | 1..100000 | off | one single level of that segment length, e.g. 150 = one per helix | rd2_relax header | `extra` |
| `--ml-cuts` | integer list | 1..100000 | 40,12 | cascade of cut lengths, coarse to fine, comma separated | rd2_relax header | `extra` |
| `--ml-iters` | integer | 1..100000 | 150 | iterations per stage of the middle layer | rd2_relax header | `extra` |
| `--ml-dmin` | number list | 0.1..20 | 2.8 | dmin stages of the middle layer, comma separated | rd2_relax header | `extra` |

### Model elements

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--no-seq-dep` | switch | - | off | use the sequence-averaged step elements even if a sequence is available (old behaviour) | rd2_relax header | `extra` |
| `--no-ss-wlc` | switch | - | off | unpaired runs as tension-only cables (old behaviour) instead of worm-like-chain springs | rd2_relax header | `extra` |
| `--xo-scaf` | choice | sym \| measured | off | also apply a scaffold-crossover pose element of the v2 parameter file: sym = derived from the staple element by relabelling the strands, measured = pentagon U-turn element (weakly determined) | rd2_relax header | `extra` |
| `--no-xo` | switch | - | off | do not use the crossover pose element | relax.cpp | `extra` |
| `--xo-element` | switch | - | on | use the crossover pose element (the default; accepted for compatibility) | relax.cpp | `extra` |
| `--xo-scale` | number | 0.01..1000 | 3 | multiplies the stiffness of the crossover pose elements | model.h | `extra` |

### oxDNA input (.top + .dat)

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--ox-start` | choice | on \| off | off | oxDNA input: start from the base-pair frames of the input configuration itself (a relaxation of the deposited conformation) instead of the relocation of the derived design's bodies (docs/34) | rd2_run header, docs/34 | `extra` |
| `--ox-pair-extend` | number | 0..20 | 0 | oxDNA input: base-site distance up to which a nucleotide that continues a found duplex is paired (0 = only the strict 0.9 test; 2.0 for unrelaxed configurations with stretched pairs) | rd2_run header | `extra` |
| `--input-layout` | choice | off \| on | auto | oxDNA input: off = the relocation only; auto = use the arrangement of the input where the relocation does not satisfy the bonds between the bodies; on = always (docs/35) | relax.h, docs/35 | `extra` |
| `--input-layout-cost` | number | 0..1000 | 4 | mean-square bond length between the bodies above which auto takes the arrangement of the input (docs/35) | relax.h, docs/35 | `extra` |

### Design file, sequence and gap linkers

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--no-normalize` | switch | - | off | do not repair self-pointing prev/next links (the parser then refuses such a file) | rd2_run header | `extra` |
| `--normalize-mode` | choice | self \| rebuild \| auto | auto | repair mode: self = unambiguous self-prev pointers, rebuild = rebuild prev from next, auto = self where unambiguous, else rebuild | rd2_run header | `extra` |
| `--strict-modifications` | switch | - | off | scadnano: refuse designs with strand modifications instead of ignoring them | rd2_run header | `extra` |
| `--random-seq` | switch | - | off | placeholder sequence: random (see the seed) instead of the periodic A,T,G,C | prepare.h | `extra` |
| `--seed` | integer | 0..2147483647 | 1 | seed of the placeholder sequence | rd2_run header | `seed` field |
| `--link-threshold` | number | 0..1000 | 3.8 | a link longer than this (oxDNA units) in the ideal geometry gets linker nucleotides | prepare.h | `extra` |
| `--link-su-per-nt` | number | 0.01..1000 | 1.8 | oxDNA units spanned by one linker nucleotide | prepare.h | `extra` |

### Native oxDNA2 relaxation and export

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--native-iters` | integer | 1..1000000 | 1500 | iterations per round of the native oxDNA2 relaxation | rd2_pipeline header | `nativeIters` field |
| `--ftol` | number | 0.001..1000 | 2 | the native relaxation stops when every \|force\| and \|torque\| is below this (oxDNA units) | rd2_pipeline header, native_relax.h | `extra` |
| `--no-dh` | switch | - | off | leave the Debye-Hueckel term out of the minimised energy (it stays in the reported energy) | rd2_pipeline header, native_relax.h | `extra` |
| `--active / --no-active` | choice (flag) | on \| off | on | FIRE on the active region only with full evaluations in between (on, default) or on every nucleotide at every iteration (off) (docs/23) | rd2_pipeline header, docs/23 | `extra` |
| `--legacy-kernel` | switch | - | off | native evaluator in double precision with per-thread force buffers, no active region | rd2_pipeline header | `extra` |
| `--no-recover` | switch | - | off | do not run the recovery stages (stiffer backbone caps, centre guard) when the gate is not met after the default relaxation (docs/21) | rd2_pipeline header | `extra` |
| `--polish` | integer | 0..1000 | 0 (off) | up to N more native rounds at force tolerance 1.0 while E/nt improves by more than 0.003; kept only if the gate still holds | rd2_pipeline header | `extra` |
| `--export-iters` | integer | 1..1000000 | 1500 | iterations of the exporter penalty relaxation of unpaired nucleotides | rd2_pipeline header | `extra` |
| `--slow-export` | switch | - | off | previous (slower) exporter penalty loop | rd2_pipeline header | `extra` |

### Solver (expert)

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--solver` | choice | block \| eigen \| legacy | block | LM linear solver: block (parallel multifrontal, default), eigen, legacy (the original reference path); the optional cholmod plugin is not in the browser build | model.h, rd2_relax header | `extra` |
| `--verlet` | switch | - | off | rebuild the pair lists when a node moved more than half the skin instead of every 5 iterations | rd2_relax header | `extra` |
| `--chord` | integer | 1..1000 | 6 | reuse a stale factorisation for this many iterations (1 = exact Newton every iteration) | model.h | `extra` |
| `--gtol` | number | 0..1 | 1e-4 | LM stops at max \|gradient\| below this (energy / length unit, rad) | model.h | `extra` |
| `--etol` | number | 0..1 | 1e-9 | LM stops when the relative energy decrease is below this | model.h | `extra` |
| `--mu0` | number | 0..1000000 | 0.01 | initial Levenberg-Marquardt damping mu0 (SolveOptions::mu0; not further described in the docs) | model.h (no description) | `extra` |
| `--mu-up` | number | 1..1000000 | 4 | mu multiplier muUp (SolveOptions::muUp; not further described in the docs) | model.h (no description) | `extra` |
| `--mu-down` | number | 1..1000000 | 3 | mu divisor muDown (SolveOptions::muDown; not further described in the docs) | model.h (no description) | `extra` |
| `--mu-up-bt` | number | 0..1000000 | 1 | mu multiplier when a backtracked step was accepted | model.h | `extra` |
| `--margin` | number | 0..10 | 0.05 | repulsion pairs within dmin*(1+margin) enter the Hessian pattern | model.h | `extra` |
| `--backtrack` | integer | 0..100 | 3 | halve the LM step up to this many times (same factorisation) before raising mu; 0 = off | model.h | `extra` |
| `--stag-window` | integer | 1..100000 | 25 | stop when the energy fell by less than the stagnation tolerance (relative) over this many iterations | model.h | `extra` |
| `--stag-tol` | number | 0..1 | 2e-3 | relative energy decrease over the stagnation window below which the node stage stops | model.h | `extra` |

### Diagnostics and output

| Option | Type | Allowed | Engine default | Meaning (from the engine docs) | Source | Bridge |
|---|---|---|---|---|---|---|
| `--route-only / --prepare-only` | choice (flag) | route-only \| prepare-only | full run | route-only: stop after the front end and print the route and the substructures; prepare-only: print the route, the notes and the design summary and stop. No structure is produced | rd2_run header | `extra` |
| `--quiet` | switch | - | off | only the summary (no stage lines in the log) | rd2_pipeline header | `extra` |
| `--exc-report` | switch | - | off | print the excluded-volume energy of the result and its worst contacts | rd2_relax header | `extra` |
| `--ml-verbose` | switch | - | off | log of the multilevel cascade | relax.cpp | `extra` |
| `--logdet` | switch | - | off | after the relaxation print the harmonic free energy terms (kT/2) ln det(H + eps I) of the Gauss-Newton Hessian (docs/08) | rd2_relax header | `extra` |

### Options that interact

Both options are passed as typed (GUI = command line); the field of the first shows a note saying what the engine does.

- `--no-exc` with `--exc`: the later --no-exc wins: no excluded volume
- `--no-multilevel` with `--multilevel`: --multilevel wins: the cascade stays on
- `--no-xo` with `--xo-element`: the later --xo-element wins: the crossover element stays on
- `--legacy` with `--subho`: --legacy ignores --subho and --multilevel
- `--legacy` with `--multilevel`: --legacy ignores --subho and --multilevel
- `--route-only` with `--orient-search`: the run stops before the relaxation: nothing is searched

## rd2_run options that the browser cannot honour

| Option | Reason |
|---|---|
| `--dat F` | set by the page from the .dat file you choose together with an oxDNA .top |
| `--seq TOP DAT` | needs a second oxDNA structure file; the browser front end passes none (the sequence is a placeholder, or that of the .top input) |
| `--template F, --params F` | file paths: the template and the parameter set are embedded in the WebAssembly module |
| `--start-poses F, --from-poses F` | pose tables are files; the browser run starts from the design itself |
| `--map F` | file path (designs with several scaffolds / linker helices) |
| `--gpu` | CUDA device: the WebAssembly build runs on the CPU (there is no WebGPU path) |
| `--keep-design, --dump-start, --write-poses, --write-forces, --dump-stages` | write extra files next to the result; the browser run returns the .top, .dat and summary only |
| `--orient-only, --check-assembly` | stop before the structure exists and write or check files; no structure to open |
| `--no-summary` | the page reads the summary of the run |
| `--solver cholmod` | optional plugin loaded with dlopen; not in the WebAssembly build |
| `--threads N` | set in the Options block above |
| `--route, --infer-staples, --no-linkers, --no-native` | set in the Options block above |
| `--version` | prints the version only |

## Notes

* Defaults are those of the engine source at `23b5a9f` (`include/rd2/relax.h`, `model.h`, `prepare.h`, `native_relax.h`, `src/pipeline.cpp`) and of the header comments of `apps/rd2_run.cpp`,
  `rd2_relax.cpp`, `rd2_pipeline.cpp`. Where the front end decides a value itself (for example the orientation search that `rd2_run` switches on for a few bodies the lattice cannot place, or the plane wall
  `--plane-k`), "default" means "decided by the engine" and the placeholder of the field says so. `--iters` is 400 in `relax.h` (the header comment of `rd2_relax` still says 80).
* `--seed` is the seed of the **placeholder sequence** (`--random-seq`), not of the layout or the relaxation, which are deterministic; `--orient-seed` seeds the orientation search.
* `--solver cholmod` is listed under the native-only options; the field offers block, eigen, legacy.
* The rigidDNA1 tab drives a different, older engine (the rigid-body clustering of `rigid-body_simulation.ts`), not `rd2_run`; it has no counterpart for these options and was not changed.
  The rigidRNA tab has its own options (`rigidrna_ui.ts`) and was not changed either; the same table-driven pattern would apply to it.
