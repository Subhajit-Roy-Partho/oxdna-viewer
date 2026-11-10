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
  program: only in the native command-line build (the browser module does not carry it: the
  program is GPL-licensed and is not compiled into the module; a model without that input
  would be a different, unevaluated model).
* **Recommendation**: for natural RNA, ML3 (native build with the pKiss program; in the blind
  look of the project it found 46 of 228 natural pseudoknots with 1 / 287 and 0 / 98 false
  helices) or NAT-1 in the browser; for designed RNA, v4 (V3D) or MS-3.
* **nat1 (NAT-1)**: natural-RNA pseudoknot model on top of the v2 candidate pool (topology price
  + logistic gate), fitted on 12-250 nt single chains at 0.25 M salt. One blind look (test2):
  24 of 228 natural pseudoknots found (10.5 %) vs 0 for the nested MFE, false helices 0 / 287
  natural no-crossing RNAs and 1 / 98 shuffles; on the 22 experimental-3D rows 1 found. The gate
  stays closed for most RNAs, then the answer is the nested MFE. Not a designed-RNA model.
* **e1 (ENERGY-1, K 30 or 50)**: NAT-1's price refitted on a pre-filtered pool: the cheapest form
  that keeps NAT-1's accuracy, NOT a more accurate energy (K = 30: 26 of 228 found, 1 / 287 and
  1 / 98 false helices; K = 50 is reported, not claimed).
* **ml4 (ML-4)**: helix-graph network (5-seed ensemble) on the NAT-1 price: does not beat
  NAT-1 at equal false-helix cost (29 of 228 found, 1 / 287 and 1 / 98 false helices). Evaluated
  in double precision in the module: equal to the float32 reference up to 2e-6 in the scores.
* **ms3 (MS-3, EXPERIMENTAL)**: one strand with the design signature (>= 34 % of the nucleotides
  in unique complementary domains of >= 8 bp, >= 10 domains, >= 150 nt) gets domain pairing + MFE
  (a DESIGN DECODER, not a blind folding model); other single strands the MFE with G-quadruplex
  protection and a stem filter; several strands MS-2 unchanged. The summary adds the assembly
  (strand contacts, complexes, strands without a partner, dimer free energy and bound fraction at
  the stated concentration: a report, not a gate). Held-out second look on 12 designs only.
* **domain pairing B / hybrid B**: design decoders (longest complementary segments first; hybrid
  adds the MFE pairs with both ends free), not blind folding models.
* **auto** (recommended, the default when the module carries it): the router of lane ROUTE-1 (rule R1, `scripts/seqpred/auto_route.py` of rigidDNA2, ported to C++ in lane CPP-5): ONE frozen model answers and the summary says which one (`arm`), why (`reason`), the class of the input, how far to trust it (router confidence level high / medium / low / unknown from the development / validation rows of ROUTE-1, not blind) and which arms were tried. Natural single RNA of 12-500 nt: ML3 in the native tool; ML3 needs the external pKiss program (GPL-3.0-or-later, not part of the module), so in the browser the line is "ML3 unavailable" and the answer comes from NAT-1 (12-250 nt) or the nested MFE; the result is flagged `mlFallback: true` and its confidence is `unknown` (the confidence table was built from ML3 answers). Designed kissing-loop RNA (V3D status designed-kissing): V3D; long designed single strands (design gate: at least 34 % of the nucleotides in unique complementary domains of at least 8 bp, at least 10 domains, at least 150 nt): MS-3; several RNA strands: MS-2; DNA: MS-3. Other temperatures than 37 C and RNA outside 12-800 nt bypass the learned arms (nested MFE). V3D runs first on every single RNA, so auto is slower than NAT-1 alone (about 20 s at 250 nt natively, about 30-60 s in the browser).
* **Scoring against a reference**: paste a reference structure (dot-bracket, pair list, bpseq or
  ct) under the arc diagram: the arcs are recoloured and the drawn candidate is scored with the
  C++ metrics of the module (pair precision / recall / F1 / MCC, crossing-pair recall, helix
  recall, pseudoknot found, false helix).
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
