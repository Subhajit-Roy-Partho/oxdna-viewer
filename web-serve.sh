#!/bin/bash
# Start oxdna-viewer as a web application (no Electron needed)
# Usage: ./web-serve.sh
# serve.json (read by `serve` from the served directory) sends Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: credentialless,
# which make the page cross-origin isolated: SharedArrayBuffer, and with it the multi-core build of the rigidDNA2 WebAssembly engine, is then available.
# Without them (another server) the rigidDNA2 window falls back to the single-thread build; coi-serviceworker.js can add the headers client-side.
echo "Starting oxdna-viewer web server on http://localhost:8766"
npx -y serve . -p 8766 --cors
