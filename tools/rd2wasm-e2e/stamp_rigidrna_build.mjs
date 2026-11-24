#!/usr/bin/env node
/**
 * stamp_rigidrna_build.mjs: writes wasm/rigidrna/build.json: the build id of the engine files (first 12 hex digits of the SHA-256 of rd2rna_mt.wasm + rd2rna_st.wasm).
 * It identifies the deployed rigidRNA build (the page does not read it yet; check a deployment with curl against wasm/rigidrna/build.json).
 * Run it after every rebuild of the .wasm files:   node tools/rd2wasm-e2e/stamp_rigidrna_build.mjs "rigidRNA rd2_rna <commit> (<branch>), emscripten 6.0.13"
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "wasm", "rigidrna");
const h = crypto.createHash("sha256");
for (const f of ["rd2rna_mt.wasm", "rd2rna_st.wasm"]) h.update(fs.readFileSync(path.join(dir, f)));
const out = { build: h.digest("hex").slice(0, 12), engine: process.argv[2] || "" };
fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out);
