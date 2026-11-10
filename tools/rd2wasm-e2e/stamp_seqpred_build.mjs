#!/usr/bin/env node
/**
 * stamp_seqpred_build.mjs: writes wasm/seqpred/build.json, the build id of the seqpred module (first 12 hex digits of the SHA-256 of seqpred_mt.wasm + seqpred_st.wasm),
 * in the style of wasm/rigiddna2/build.json. The page reads it with cache: 'no-store' and requests the worker and the module as ...?v=<build>.
 * Run it after every rebuild:   node tools/rd2wasm-e2e/stamp_seqpred_build.mjs "seqpred <commit> (rigidDNA2 branch seqpred-cpp) + ViennaRNA 2.7.2, emscripten 6.0.13"
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "wasm", "seqpred");
const h = crypto.createHash("sha256");
for (const f of ["seqpred_mt.wasm", "seqpred_st.wasm"]) h.update(fs.readFileSync(path.join(dir, f)));
const out = { build: h.digest("hex").slice(0, 12), engine: process.argv[2] || "" };
// the bld2 motif library (lane CPP-5), fetched lazily by the tab: its own version goes into the cache key
const lib = path.join(dir, "bld2_lib.bin");
if (fs.existsSync(lib)) out.bld2lib = crypto.createHash("sha256").update(fs.readFileSync(lib)).digest("hex").slice(0, 12);
fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out);
