# seqpred user guide (rigidRNA tab: "Sequence only: predict with seqpred")

seqpred predicts the secondary structure of an RNA sequence (or several strands for the
multi-strand methods) entirely in your browser (WebAssembly, in a background worker): a nested
minimum-free-energy structure with the Turner 2004 parameters and the salt correction of
ViennaRNA 2.7, plus the kissing-loop / pseudoknot layer of the chosen single-chain model. The
result fills the dot-bracket field above (you can edit it before pressing "Build and load"); the
free energies come from the ViennaRNA 2.7.2 library (Lorenz et al., Institute for Theoretical
Chemistry, University of Vienna), compiled to WebAssembly. seqpred is a C++ re-implementation
of the rigidDNA2 Python predictors. ViennaRNA 2.7.2 code is free for research and commercial
use, not to be redistributed for a fee; credit as in the previous sentence.

## Which model to use

The model selector lists every single-chain model the loaded build carries; the rest is
disabled and says "not in this build". The one honest line under the selector comes from the
module when it carries one, else from the sealed test of the project (44 natural pseudoknot
RNAs, 150+150 RNAs without pseudoknot, 46 designed RNAs, 100 shuffled sequences):

* **v2 (default)**: strong on designed kissing RNAs (held-out designed kissing-F1 0.956); on
  natural RNAs it returns the nested fold (0 of 44 natural pseudoknots found). Use it unless
  you have a reason not to.
* **v3**: v2 plus closing-helix candidates; same behaviour as v2 on natural RNAs; no
  held-out result of its own.
* **v4** (where available): designed-RNA pair F1 equal to v2 (0.9706 vs 0.9706 on 46
  designed RNAs), nested-like on natural and shuffled RNAs; reports a confidence status.
* **m2 (experimental)**: more natural pseudoknots found (3 of 44 vs 0 for v2) but many
  false helices on RNAs without a pseudoknot (8 % of 150 natural RNAs, 21 % of shuffled
  sequences).
* **h2d (experimental)**: 3 of 44 natural pseudoknots found vs 0 for v2; false helices on
  4.7 % of 150 natural RNAs and 11 % of shuffled sequences.
* **ml2 / ml3 (re-rankers, do-no-harm)**: false helices stay rare (ml3: 1.3 % of 150
  natural RNAs, 2.0 % of shuffles) but the natural pseudoknot gain was NOT demonstrated on
  the sealed test (1 of 44 vs 0 for v2, interval includes 0). ml3 needs the external pKiss
  program: only in the native command-line build (in the browser the module offers ml3nok
  if it is in the build, a different model without that input).
* **ms2 (multi-strand RNA / DNA)**: on 200 DNA complexes F1 0.726 vs 0.720 for the
  shipped DNA predictor (not distinguishable, +/- 0.03).
* **MS-RNA v4, DNA hybrid, single-stranded DNA tools**: the older multi-strand and DNA
  lanes (kept working); the DNA methods are prediction only (the rigidRNA engine builds
  RNA structures).

## Options

Salt: all methods (monovalent salt of the free-energy model; 0.25 M is the setting the
predictor weights were fitted at). Threads: all single-chain models (needs a
cross-origin-isolated page for the multi-core build); ms2 runs single-threaded. Time
budget: all methods — it bounds EVERY stage; a stopped run says truncated, names the
stage it stopped at, and returns the best candidate found so far. Gate margin (m2, h2d):
the score a crossing candidate must beat the best nested candidate by (defaults m2 2,
h2d 4; 1e9 disables the gate). Discriminator threshold p (ml2, ml3, 0-1, default 0.7):
the crossing candidate is returned only if the discriminator probability reaches it.
Multi-strand block (ms2 and MS-RNA): molecule (auto / RNA / DNA), temperature, declared
assembly (every strand must touch another strand), kissing prior (RNA), and the DNA
mode toggles (G-quadruplex tracts are protected from pairing; second DNA state).

## How to read the summary

Model and build id, nested MFE energy (Turner 2004, salt corrected), the selected
score (lower is better; the scale differs per model), the margin to the nested-MFE
decoy, the gate decision (margin: fired / not met with the margin value; discriminator:
p vs threshold; plus the stage-1 nested and crossing scores where the module reports
them), the confidence status with its colour (designed-kissing green, extra-helices
blue, nested grey, low-confidence and fallback-nested amber) and the per-helix rule
list (ga, dis_or_casc, lpc; empty means no design rule admits the helix), the number
of crossing helices (pairs in layers >= 1 grouped into stacks), engine and loading
times ("engine X s, loading Y s": module compute vs creating the worker to ready),
the version line (seqpred, predictor, ViennaRNA, git short hash), and the module notes.
Multi-strand results add the strands, the primary state, the alternative states (each
can be written into the dot-bracket field), and the G-quadruplex / kissing-prior
lines. After a prediction three download buttons offer the result as dot-bracket
(.dbn), pair list (.json) and FASTA plus dot-bracket (.fa); file names are
`<model>_<n>nt.<ext>`, and the FASTA has one record per strand for multi-strand
results. Fields a build does not report say so honestly instead of guessing.

## Selection panel (every single-chain model)

Blue pairs sit inside the nested stems, red pairs cross them (the kissing /
pseudoknot layer the selection added), grey pairs below the axis are the nested-MFE
decoy without any long-range layer. The ranked candidates carry the model's score
(lower is better); for the discriminator models the gate line shows p and the
threshold. Click a row to draw it; "use" writes it into the dot-bracket field (then
"Build and load" builds it). A reference dot-bracket of the same length can be
overlaid: predicted pairs missing from it turn orange, and the pair F1 is reported.

## Limits

Sequences longer than 600 nt get the nested MFE only (the long-range search takes
minutes at 400 nt in one thread). A prediction is a prediction, not a measurement:
short stems and hairpins are mostly right; junctions, ligand-bound aptamers and
kissing complexes are not; on natural RNAs the kissing layer adds nothing to the
nested MFE (it targets designed kissing-loop RNAs). MS-RNA answers a kissing-complex
versus extended-duplex question with a set of states: read the alternatives. The
module has no NUPACK (proprietary). Cancel stops the worker at once; the next run
starts a fresh one.
