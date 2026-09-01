// Web deployment configuration for oxdna-viewer
// Loaded before any other scripts in index.html when running as web app.
//
// This file is committed to git — DO NOT put API keys here.
// Real keys go in ts/config.js (gitignored), which is loaded afterwards and
// merges into (does not replace) this object. See ts/config.example.js.
window.OXVIEW_CONFIG = Object.assign(window.OXVIEW_CONFIG || {}, {
    mode: 'web',
    nanocanvasURL: 'http://localhost:5173',
    nanocanvasBackendURL: 'http://localhost:8765',
    websocketURL: 'ws://localhost:8765/ws',

    // LLM Chat (💬) — OpenAI-compatible endpoint
    llmBaseURL: 'https://nano-gpt.com/api/v1',
    llmModel: 'z-ai/glm-5.3:thinking',
    llmApiKey: '',            // set in ts/config.js (gitignored) or via the 🔑 button

    // Agent Chat (🤖) — multi-agent pipeline
    agentBaseURL: 'https://nano-gpt.com/api/v1',
    agentModel: 'z-ai/glm-5.3:thinking',
});
