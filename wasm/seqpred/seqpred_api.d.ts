// Typed contract of seqpred_api.js (the result is the JSON of seqpred::predictJson, include/seqpred/predict.h).
export type Method = 'v2' | 'nested' | 'hint' | 'v3' | 'm2' | 'msrna' | 'dna' | 'ssdna' | 'rna_kl' | 'kl_routes' | 'longrange' | 'cassette';
export interface PredictOptions {
  method?: Method;                 // default 'v2': nested MFE + kissing / pseudoknot layer (predictor v2); 'nested': Turner 2004 MFE only; 'hint': designed helices given in `hints`; 'm2': EXPERIMENTAL re-ranker of the v2 pool
  model?: 'v2' | 'v3' | 'm2';      // alias of method for 'v2'|'v3'|'m2' (m2 is EXPERIMENTAL; v2 is the default)
  gateMargin?: number;             // m2 gate margin (default 2; 1e9 disables the gate); finite number >= 0
  salt?: number;                   // monovalent salt, mol/L (default 0.25; 1.021 = Turner standard)
  temp?: number;                   // deg C, nested part only (default 37)
  threads?: number;                // worker threads of the fold batches (threaded build only)
  budgetSeconds?: number;          // stop starting new host-refinement rounds after this time; result.truncated tells
  maxLength?: number;              // longer sequences get the nested MFE only (browser default 600, 0 = no cap)
  detail?: boolean;                // add the candidate table and the nested-part parity quantities
  hints?: Array<{ i: number; j: number; k: number } | string>;   // 1-based outer pair + number of pairs, or 'a-b:c-d'
  weights?: { weights: Record<string, number>; version?: string };   // replaces the embedded v2 weights (e.g. predictor v3)
}
export interface Helix { i: number; j: number; k: number; pairs: Array<[number, number]> }   // 1-based
export interface SelectionCandidate { rank: number; index: number; inTop: boolean; label: 'nested' | 'crossing'; score: number; nHelices: number; dotbracket: string; pairs: Array<[number, number]>; layers: number[]; helices: Array<{ i: number; j: number; k: number }>; hostSource: string; chosen: boolean; bestNested: boolean; bestCrossing: boolean; isNestedMfe: boolean }   // one ranked pool candidate (index: full list with detail:true; rank: 1-based by score, lower is better)
export interface SelectionGate { enabled: boolean; fired: boolean; margin: number | null; marginValue: number | null; reason: string; bestNested: number | null; bestCrossing: number | null }   // marginValue = best nested score minus best crossing score; the gate fires when it exceeds margin
export interface NestedMfeDecoy { dotbracket: string; pairs: Array<[number, number]>; layers: number[]; energy: number; candidateIndex: number | null }   // salt-corrected Turner-2004 MFE decoy
export interface Selection { model: string; experimental: boolean; scoreName: string; nCandidates: number; nNested: number; nCrossing: number; gate: SelectionGate; chosen: number; nestedMfe: NestedMfeDecoy; candidates: SelectionCandidate[]; margin?: number; poolOutKeep?: number }   // top 20 by score (inTop) plus chosen / best nested / best crossing / nested-MFE candidate (m2 also carries margin, poolOutKeep)
export interface PredictResult {
  ok: true;
  sequence: string;                // upper case, T read as U
  length: number;
  method: Method;
  salt: number;
  dotbracket: string;              // nested pairs (), first crossing layer [], then {} and <>
  pairs: Array<[number, number]>;  // 1-based, i < j
  layers: number[];                // layer of each pair: 0 nested, 1.. crossing (kissing / pseudoknot)
  helices: Helix[];                // the long-range helices (kissing layer) of the structure
  energy: { nestedMfe: number; nestedDotbracket: string; hostEnergy?: number; hostDotbracket?: string; hostSource?: string; score?: number };
  notes: string[];
  timings: { total: number; nestedMfe: number; search?: number; design?: number; score?: number; predict?: number };
  version: { seqpred: string; buildId: string; git: string; viennarna: string; parameters: string; predictor: string; model?: string; experimental?: boolean; models?: Record<string, { status: string; label: string; note?: string }> };
  truncated: boolean;
  capped?: boolean;
  nCandidates?: number;
  selection?: Selection;           // candidate selection graph of the v2/v3/m2 ranking models
  top?: Array<{ rank: number; score: number; helices: number[][]; hostSource: string }>;
}
export interface Seqpred {
  predict(sequence: string, options?: PredictOptions): PredictResult;    // throws SeqpredError for ok:false
  predictRaw(sequence: string, options?: PredictOptions): string;        // JSON text
  version(): PredictResult['version'];
  build3d(result: PredictResult, rd2Api: unknown, rd2Module: unknown, options?: Record<string, unknown>): Promise<{ rc: number; top: string | null; dat: string | null; report: unknown; log: string; seconds: number }>;
}
export class SeqpredError extends Error {}
export function load(factory: unknown, config?: { locateFile?: (p: string) => string }): Promise<Seqpred>;
