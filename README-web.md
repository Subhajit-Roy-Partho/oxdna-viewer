# Running oxdna-viewer as a Web App

No Electron required. Just serve the directory:

```bash
# Option 1: use the provided script
./web-serve.sh

# Option 2: npm
npm run serve

# Option 3: Python
python3 -m http.server 8766
```

Then open http://localhost:8766 in your browser.

## Integration with NanoCanvas
Open the integration page: http://localhost:8766/integration/nanocanvas_embed.html
(Start NanoCanvas on port 5173 and the NanoCanvas backend on port 8765 first)
