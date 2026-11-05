# rigidRNA tab: the options of `rd2_rna` in the browser

The rigidRNA tab of the rigidDNA window runs `rd2_rna` of the rigidRNA engine compiled to WebAssembly (`wasm/rigidrna/`, `wasm/build.sh` of the engine; the engine commits
and the build flags are in `docs/WASM_BUILDS.md`). A run in the browser is the command line `rd2_rna <input> --params ... --template ... --out out [options]` on an in-memory
file system. The tab shows the command line it runs (section **Command line preview**, also the first line of the log), made by `Rd2RnaApi.buildArgs` of
`wasm/rigidrna/rd2rna_api.js`, the function the worker runs.

## Input (block "1. Structure")

| Input | Engine input | What the tab passes |
|---|---|---|
| Sequence + dot-bracket | `--seq S --db D` | A, C, G, U (T is read as U), N for an unknown base, `&` or `/` between strands; the dot-bracket may repeat the separators or leave them out; pseudoknots as `[] {} <>` and `A a`, `B b`, ... |
| Sequence only | `--seq S --predict MODE` | the engine predicts the structure (Turner 2004): `mfe`, `mea` (with `--gamma`), `probknot`, `layers` (pseudoknots); `--maxspan` limits the span of a pair (400 for kilobase scaffolds) |
| PDB / mmCIF file | `--pdb F [--pdb-chains A,B] [--pdb-model N\|all]` | nucleotide frames and Leontis-Westhof pairs are computed by the engine (`rna_pdb.cpp`), the 3D structure is the start; "Lay out de novo from the pairs" adds `--layout` (the coordinates are ignored) |
| rigidRNA design JSON | `--json F` | `sequence`, `structure` or `pairs`, `strands`, `contacts` as in `data/rna/designs` of the engine |

## Basic options (block "2. Options")

`--salt` (mol/l, written into the oxRNA2 inputs, default 0.5), `--temp` (K, 300), `--iters` (Levenberg-Marquardt iterations of the last stage, 300), `--elec` (oxRNA2 Debye-Hueckel
between the backbone charges of different stems in the rigid model), `--threads`.

## Advanced properties

A blank field passes nothing (engine default). An invalid entry is marked red and is not passed.

| Option | Default | Meaning |
|---|---|---|
| `--min-stem N` | 2 | helices shorter than N bp are not modelled as rigid nodes (isolated-pair flag and trap) |
| `--no-gu` | off | do not model G-U pairs |
| `--dmin D`, `--krep K` | 2.8, 5 | helix-axis repulsion distance and stiffness. The RNA test of a larger dmin was negative (docs/55 of the engine repository), the default stays |
| `--no-relax` | off | export the start poses without Levenberg-Marquardt |
| `--no-rodnet`, `--no-embed`, `--no-compact` | off | de novo layout without the rod-network optimisation (RNA-15), without its graph-embedding start, without the compaction towards the Rg law (RNA-21) |
| `--compact-kc K`, `--compact-scale X`, `--compact-dmin D`, `--embed-reach F` | 0.1, 1.0, rod distance, 0.6 | strength of the compaction pull, scale of its target Rg, rod distance while compacting, edge reach of the stem graph |
| `--no-seed-unpaired` | off | with a PDB start: rebuild the unpaired nucleotides with the loop builder instead of taking the input frames (RNA-17) |
| `--elec-scale X` | 1.0 | multiplies the oxRNA2 charge strength (only with Electrostatics) |
| `--fold-check` | off | ensemble probability of every modelled stem (McCaskill); stems below 0.2 are flagged `weak_in_ensemble` |
| `--toehold A-B` | none | nucleotides A..B (0-based) kept single stranded and extended; a comma separated list gives several |
| `--no-ss-repair`, `--no-global-repair` | off | skip the single-strand repair and the global close-pair repair of the export (RNA-22) |
| other options (verbatim) | - | any further switch exactly as on the command line (for example the other `--compact-*` tunables); inputs, outputs and threads are set by the tab |

## Options of `rd2_rna` that the tab does not offer

* `--keep-open`, `--base-flip`, `--back-flip`, `--hold`: they write external-force entries for the oxRNA2 molecular dynamics (force files); the tab loads the `.top` and `.dat` only.
* `--constraint`: folding constraint of the predictor (notation in `apps/rd2_fold.cpp`).
* `--write-pdb`: writes an approximate all-atom PDB; the worker returns the `.top` and `.dat` only.
* `--conf TOP DAT --pairs F`: an oxRNA configuration as the start; use a PDB file or a design JSON.
* `--params`, `--template`, `--out`: file paths; parameter set and template are embedded in the module.
* The other entry points of the module (`rd2rnaw_tool`: `fold`, `substruct`, `pdb2rna`, `oxrna2pdb`) are in the WebAssembly module but have no page.

The oxRNA2 molecular-dynamics relaxation ("polish", engine docs RNA-20 and RNA-24) is a separate step that needs the external oxDNA / oxpy program; it is not part of the engine
or of this tab.

Tests: `tools/rd2wasm-e2e/rigidrna.mjs` (headless Chromium: tab, sequence + dot-bracket run with and without electrostatics, refusal of a length mismatch) and
`tools/rd2wasm-e2e/rnamodes.mjs` (the other inputs, the advanced fields and the command line preview).
