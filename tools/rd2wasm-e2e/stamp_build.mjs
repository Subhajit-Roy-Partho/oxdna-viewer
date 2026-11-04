#!/usr/bin/env node
/**
 * stamp_build.mjs — writes wasm/rigiddna2/build.json: the build id of the engine files (first 12 hex digits of the SHA-256 of rd2_mt.wasm + rd2_st.wasm).
 * The page reads it with cache: 'no-store' and requests the worker and the module as ...?v=<build>, so a browser cache cannot serve another build.
 * Run it after every rebuild of the .wasm files:   node tools/rd2wasm-e2e/stamp_build.mjs "rigidDNA2 engine <commit> (<branch>)"
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "wasm", "rigiddna2");
const h = crypto.createHash("sha256");
for (const f of ["rd2_mt.wasm", "rd2_st.wasm"]) h.update(fs.readFileSync(path.join(dir, f)));
const out = { build: h.digest("hex").slice(0, 12), engine: process.argv[2] || "" };
fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out);
