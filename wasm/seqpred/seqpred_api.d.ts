// Typed contract of seqpred_api.js (the result is the JSON of seqpred::predictJson, include/seqpred/predict.h).
export type RankModel = 'v2' | 'v3' | 'v4' | 'm2' | 'h2d' | 'ml2' | 'ml3';
export type PriceModel = 'nat1' | 'e1' | 'e1k50' | 'ml4';   // NAT-1, ENERGY-1 (K 30 / 50), ML-4: nested MFE + gated crossing candidate of the v2 pool (docs/97)
export type Method = RankModel | PriceModel | 'ms3' | 'domainB' | 'hybridB' | 'auto' | 'score' | 'bld2' | 'centroid' | 'mea' | 'oxpairs' | 'nested' | 'hint' | 'ms2' | 'msrna' | 'dna' | 'ssdna' | 'rna_kl' | 'kl_routes' | 'longrange' | 'cassette';
export interface PredictOptions {
  method?: Method;                 // default 'v2': nested MFE + kissing / pseudoknot layer (predictor v2); 'nested': Turner 2004 MFE only; 'hint': designed helices given in `hints`; 'm2' etc. select the ranking model (same as model)
  model?: RankModel | PriceModel;  // alias of method for the ranking / price models (m2 and h2d are EXPERIMENTAL; v2 is the default)
  k?: 30 | 50;                     // e1 only: pre-filter size of ENERGY-1 (default 30; e1k50 = 50)
  mg?: number; concUM?: number;    // ms3 only: Mg2+ (mol/L) and strand concentration (uM) of the dimer table
  assembly?: boolean;              // ms3 only: assembly summary (default true)
  chance?: number;                 // domainB / hybridB: chance parameter of the domain pairing (default 0.3)
  gateMargin?: number;             // m2 (default 2) / h2d (default 4) gate margin; 1e9 disables the gate; finite number >= 0
  thr?: number;                    // ml2/ml3 discriminator threshold (default 0.7); probability in [0, 1]
  salt?: number;                   // monovalent salt, mol/L (default 0.25; 1.021 = Turner standard)
  temp?: number;                   // deg C, nested part (default 37; ms2/msrna/dna single-strand paths use their own defaults)
  threads?: number;                // worker threads of the fold batches (threaded build only)
  budgetSeconds?: number;          // bounds every stage; result.truncated tells (timings.truncatedAt names the stage)
  maxLength?: number;              // longer sequences get the nested MFE only (browser default 600, 0 = no cap)
  detail?: boolean;                // add the candidate table and the nested-part parity quantities (plus featureTop/columns for ml2/ml3 with dumpFeatures)
  hints?: Array<{ i: number; j: number; k: number } | string>;   // 1-based outer pair + number of pairs, or 'a-b:c-d'
  weights?: { weights: Record<string, number>; version?: string };   // replaces the embedded v2 weights (e.g. predictor v3)
  molecule?: 'auto' | 'RNA' | 'DNA';   // ms2 only: strand molecule (default 'auto')
  declaredAssembly?: boolean;      // ms2 only (default true)
  kissPrior?: boolean;             // ms2 RNA only (default true)
  g4?: boolean;                    // ms2 DNA only: G-quadruplex layer (default true)
  msdna?: boolean;                 // ms2 DNA only (default true)
  pkissStructures?: string[];      // ml3 only: 'db|energy|strategy' proposals (may be empty); overrides running the pKiss program
  pkissDir?: string;               // ml3 only, native build: directory of the pKiss program
  v2Rank?: number[];               // parity-tool option: v2_rank column of the reference run, one value per candidate; empty = computed here
  dumpFeatures?: boolean | 'all';  // parity-tool option: with detail, add featureTop + columns ('all' also adds featureAll); ml2/ml3 only
}
export interface Helix { i: number; j: number; k: number; pairs: Array<[number, number]> }   // 1-based
export interface SelectionCandidate { rank: number; index: number; inTop: boolean; label: 'nested' | 'crossing'; score: number; nHelices: number; dotbracket: string; pairs: Array<[number, number]>; layers: number[]; helices: Array<{ i: number; j: number; k: number }>; hostSource: string; chosen: boolean; bestNested: boolean; bestCrossing: boolean; isNestedMfe: boolean }   // one ranked pool candidate (index: full list with detail:true; rank: 1-based by score, lower is better)
export type GateKind = 'margin' | 'discriminator' | 'logistic' | 'none';
export interface SelectionGate { enabled: boolean; fired: boolean; kind?: GateKind; margin: number | null; marginValue: number | null; reason: string; bestNested: number | null; bestCrossing: number | null; thr?: number | null; pOpen?: number | null; pCross?: number | null; stage1Nested?: number | null; stage1Crossing?: number | null }   // marginValue = best nested score minus best crossing score; kind margin (m2/h2d), discriminator (ml2/ml3: thr/pCross/stage1*), none (v2/v3/v4/fallback)
export interface NestedMfeDecoy { dotbracket: string; pairs: Array<[number, number]>; layers: number[]; energy: number; candidateIndex: number | null }   // salt-corrected Turner-2004 MFE decoy
export interface Selection { model: string; experimental: boolean; scoreName: string; nCandidates: number; nNested: number; nCrossing: number; gate: SelectionGate; chosen: number; nestedMfe: NestedMfeDecoy; candidates: SelectionCandidate[]; margin?: number; poolOutKeep?: number; poolSize?: number; fullPool?: number; route?: string; sources?: string[]; v2PickExtra?: boolean; fallbackFrom?: string; pkissUsed?: boolean; budgetTruncated?: boolean }   // candidate selection graph (m2/h2d: margin/poolOutKeep, h2d also poolSize/fullPool; ml2/ml3: route/sources/v2PickExtra/pkissUsed/budgetTruncated/fallbackFrom)
export type ConfidenceStatus = 'designed-kissing' | 'low-confidence' | 'nested' | 'extra-helices' | 'fallback-nested' | 'truncated' | 'single-state' | 'alternatives';
export interface ConfidenceHelix { i: number; j: number; k: number; rules: string[]; lpc: number | null }   // one extra helix with admitting rules and diagnostic lpc score
export interface Confidence { model: string; status: ConfidenceStatus; reason?: string; nExtraHelices: number; ruleFired: boolean; marginNested: number | null; marginOther: number | null; helices: ConfidenceHelix[]; nWindowsLpc?: number; pCross?: number; statusBeforeTruncation?: string }   // v4: calibrated design status; other single-chain models: nested/extra-helices (+pCross for ml2/ml3); ms2: single-state/alternatives
export interface VersionModel { label: string; status: string; available?: boolean; tradeoff?: string; options?: string[]; needs?: string; note?: string }
export interface RankPredictResult {
  ok: true;
  sequence: string;                // upper case, T read as U
  length: number;
  method: RankModel;
  salt: number;
  dotbracket: string;              // nested pairs (), first crossing layer [], then {} and <>
  pairs: Array<[number, number]>;  // 1-based, i < j
  layers: number[];                // layer of each pair: 0 nested, 1.. crossing (kissing / pseudoknot)
  helices: Helix[];                // the long-range helices (kissing layer) of the structure
  energy: { nestedMfe: number; nestedDotbracket: string; hostEnergy?: number; hostDotbracket?: string; hostSource?: string; score?: number };
  notes: string[];
  timings: { total: number; nestedMfe?: number; search?: number; design?: number; score?: number; predict?: number; stages?: Array<[string, number]>; truncatedAt?: string; stagesMl?: Record<string, number> };
  version: { seqpred: string; buildId: string; git: string; viennarna: string; parameters: string; predictor: string; model?: string; experimental?: boolean; models?: Record<string, VersionModel>; modelData?: Record<string, string> };
  truncated: boolean;              // time budget cut the run (bounds every stage; timings.truncatedAt names the stage)
  capped?: boolean;
  fallback?: boolean;              // fallback result (v4 non-ACGU/>800nt; ml2/ml3 outside 12..maxLen): nested MFE, status fallback-nested
  fallbackMl2?: boolean;           // ml3 without pKiss ran ML2 instead (selection.fallbackFrom is 'ml3')
  nCandidates: number;
  selection: Selection;            // candidate selection graph of the v2/v3/v4/m2/h2d/ml2/ml3 ranking models
  confidence: Confidence;
  top?: Array<{ rank: number; score: number; helices: number[][]; hostSource: string }>;   // absent on fallback results
  pkissStructures?: string[];      // ml3: 'db|energy|strategy' proposals used (may be empty)
  featureTop?: Record<string, Array<number | null>>;   // ml2/ml3 with detail + dumpFeatures: top-20 feature rows by candidate index
  columns?: string[];              // ml2/ml3 with detail + dumpFeatures: featureTop column names
  featureAll?: Array<Array<number | null>>;   // ml2/ml3 with dumpFeatures 'all': every candidate's feature row
}
export interface NestedPredictResult {
  ok: true; sequence: string; length: number; method: 'nested'; salt: number;
  dotbracket: string; pairs: Array<[number, number]>; layers: number[]; helices: Helix[];
  energy: RankPredictResult['energy']; notes: string[]; timings: RankPredictResult['timings'];
  version: RankPredictResult['version']; truncated: boolean; capped?: boolean;
}
export interface MsState { name: string; F: number; dotbracket: string; pairs: Array<[number, number]>; layers: number[] }
export interface Ms2PredictResult {
  ok: true; method: 'ms2'; molecule: 'RNA' | 'DNA'; route: string;
  sequence: string; strands: string[]; lengths: number[]; length: number;
  dotbracket: string; pairs: Array<[number, number]>; layers: number[];
  energy: { freeEnergy?: number }; alternatives: MsState[];
  g4: Array<{ strand: number; offset: number; tracts: Array<[number, number]>; L: number; loops: number[] }>;
  kissPrior?: { fired: boolean; dF: number; dFd: number; Lk: number; nk: number; nin: number; nintra: number; Lintra: number; fracInterNested: number };
  notes: string[]; truncated: boolean; timings: { total: number };
  version: RankPredictResult['version']; confidence: Confidence;
}
export interface MsrnaPredictResult {
  ok: true; method: 'msrna'; sequence: string; strands: string[]; lengths: number[]; length: number;
  dotbracket: string; pairs: Array<[number, number]>; layers: number[];
  energy: { freeEnergy: number }; primary: string; alternatives: MsState[];
  notes: string[]; timings: { total: number }; version: RankPredictResult['version'];
}
export interface DnaPredictResult {
  ok: true; method: 'dna'; sequence: string; strands: string[]; lengths: number[]; length: number; temp: number;
  dotbracket: string; pairs: Array<[number, number]>; layers: number[];
  aPairs: Array<[number, number]>; bPairs: Array<[number, number]>; keptPairs: Array<[number, number]>; ordering: number[];
  energy: { mfeA: number }; notes: string[]; timings: { total: number }; version: RankPredictResult['version'];
}
export interface MotifScan { motifs: Array<Array<[number, number]>>; positions: number[] }
export interface SsdnaPredictResult {
  ok: true; method: 'ssdna'; sequence: string; strands: string[]; lengths: number[]; length: number; temp: number;
  dotbracket: string; pairs: Array<[number, number]>; layers: number[];
  mfePairs: Array<[number, number]>; meaPairs: Array<[number, number]>; domainPairs: Array<[number, number]>;
  domainBClean: Array<[number, number]>; rodLayout: Array<[number, number]>;
  g4: MotifScan; imotif: MotifScan; energy: { mfe: number; mea: number };
  notes: string[]; timings: { total: number }; version: RankPredictResult['version'];
}
export type PredictResult = RankPredictResult | NestedPredictResult | Ms2PredictResult | MsrnaPredictResult | DnaPredictResult | SsdnaPredictResult;
export interface ErrorResult { ok: false; error: string; truncated?: boolean; budgetStage?: string }
export interface Seqpred {
  predict(sequence: string, options?: PredictOptions): PredictResult;    // throws SeqpredError for ok:false
  predictRaw(sequence: string, options?: PredictOptions): string;        // JSON text
  version(): RankPredictResult['version'];
  build3d(result: PredictResult, rd2Api: unknown, rd2Module: unknown, options?: Record<string, unknown>): Promise<{ rc: number; top: string | null; dat: string | null; report: unknown; log: string; seconds: number }>;
  loadBld2Library(bytes: Uint8Array | ArrayBuffer): { ok: true; bytes: number; sha1: string; chains: number; loopInstances: Record<string, number>; extInstances: Record<string, number> };   // lane CPP-5: motif library of bld2
  buildBld2(sequence: string, structure: Array<[number, number]> | string, options?: { oxrna?: boolean }): Bld2Result;   // throws SeqpredError (library not loaded, non-ACGU, bad dot-bracket)
  bld2Loaded(): unknown;
  score(request: ScoreRequest): ScoreResult;                              // pair set against a reference structure (CPP-4)
  oxPairs(request: OxPairsRequest): OxPairsResult;                        // base pairs of an oxDNA / oxRNA configuration (CPP-6); throws SeqpredError
}
export interface Bld2Loop { index: number; exterior: boolean; arms: number; segments: number[]; source: string | null; instanceSegments: number[] | null; store: string | null; instanceIndex: number | null; generic: boolean }
export interface Bld2Result { ok: true; method: 'bld2'; sequence: string; length: number; pdb: string; oxrna?: { top?: string; dat?: string; n?: number; pieces?: number; nicksAfter5to3Index?: number[]; box?: number; error?: string }; loops: Bld2Loop[]; nStems: number; nPairsNested: number; nPkStemsUnplaced: number; nPairsGiven: number; secondsBuild: number; library: { bytes: number; sha1: string; chains: number }; notes: string[] }
export class SeqpredError extends Error {}
export function load(factory: unknown, config?: { locateFile?: (p: string) => string }): Promise<Seqpred>;

// ---- models added by lane CPP-4 (docs/97) -------------------------------------------------------------------------------------------------------------------------------------------------
export interface NatBlock { status: 'pseudoknot' | 'nested'; margin: number | null; gap2: number | null; gateProbability: number; threshold: number; confidence: number; topology: string[]; nCandidates: number; nPoolCrossing?: number; nPool: number; zmfe: number | null; priceNested?: number; tieAtTop: boolean; gateFeatures?: Record<string, number>; prefilterK?: number; natDotbracket: string }   // result.nat of nat1 / e1 / e1k50
export interface Ml4Block { status: 'pseudoknot' | 'nested'; margin: number | null; gap2: number | null; marginSd: number | null; priceMargin: number | null; residualMargin: number | null; gateProbability: number; threshold: number; confidence: number; topology: string[]; nCandidates: number; nPool: number; zmfe: number | null; tieAtTop: boolean; nSeeds: number; gateFeatures?: Record<string, number>; natDotbracket: string }   // result.ml4
export interface Ms3Assembly { contacts: Array<{ strands: [number, number]; interPairs: number }>; complexes: number[][]; unpartneredStrands: number[]; dimers: Array<{ i: number; j: number; dGAssoc: number; boundFraction: number }> | null }
export interface Ms3Result { ok: true; method: 'ms3'; molecule: 'RNA' | 'DNA'; route: string; sequence: string; strands: string[]; lengths: number[]; length: number; mixedDnaRna: boolean; dotbracket: string; dotbracketLayers7: string; pairs: Array<[number, number]>; layers: number[]; pairsByStrand: number[][]; energy: { freeEnergy?: number }; signature?: { n: number; cover: number; nstem: number; excess: number }; design?: boolean; g4: Array<{ tracts: number[][]; L: number; loops: number[] }>; alternatives: Array<{ name: string; F: number; dotbracket: string; pairs: Array<[number, number]>; layers: number[] }>; assembly?: Ms3Assembly; notes: string[]; truncated: boolean; timings: { total: number }; version: Record<string, any>; confidence: Confidence }
export interface DomainResult { ok: true; method: 'domainB' | 'hybridB'; molecule: 'RNA' | 'DNA'; sequence: string; strands: string[]; lengths: number[]; length: number; salt: number; dotbracket: string; pairs: Array<[number, number]>; layers: number[]; energy: { mfeA?: number }; domain: { nB: number; nA?: number; nAKept?: number; energyA?: number }; notes: string[]; truncated: boolean; timings: { total: number }; version: Record<string, any>; confidence: Confidence }
export interface ScoreRequest { reference: { format: 'dotbracket' | 'pairs' | 'bpseq' | 'ct'; text: string }; prediction: { pairs?: Array<[number, number]>; dotbracket?: string }; n?: number; options?: { nested?: Array<[number, number]>; minHelix?: number; helixFrac?: number; regions?: Array<[string, number, number]> } }
export interface ScoreResult { ok: true; reference: { n: number; nPairs: number; pairs: Array<[number, number]>; kind: string; source: string; notes: string[] }; score: Record<string, number | boolean | null | Array<Record<string, any>>> }   // keys of scripts/seqpred/runall/metrics.py score
export interface OxPairsRequest { top: string; dat: string; molecule?: 'RNA' | 'DNA'; minStack?: number; hbMax?: number }   // oxDNA / oxRNA topology + configuration text (old or new topology format)
export interface OxPairsResult { ok: true; method: 'oxpairs'; molecule: string; sequence: string; strands?: number[]; n: number; pairs: Array<[number, number]>; dotbracket: string; layers: number[]; nGeo: number; compGeo: number | null; compGeoReversed: number | null; notes: string[]; t?: number | null }   // pairs 1-based, 5'->3' on the concatenation of the rebuilt strands
