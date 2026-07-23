#!/bin/bash
# Start oxdna-viewer as a web application (no Electron needed)
# Usage: ./web-serve.sh
echo "Starting oxdna-viewer web server on http://localhost:8766"
npx -y serve . -p 8766 --cors
