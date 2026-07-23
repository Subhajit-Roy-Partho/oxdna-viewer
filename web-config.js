// Web deployment configuration for oxdna-viewer
// Loaded before any other scripts in index.html when running as web app
window.OXVIEW_CONFIG = {
    mode: 'web',
    nanocanvasURL: 'http://localhost:5173',
    nanocanvasBackendURL: 'http://localhost:8765',
    websocketURL: 'ws://localhost:8765/ws',
    llmBaseURL: 'https://nano-gpt.com/api/v1',
    llmModel: 'zai-org/glm-5.2:thinking',
    llmApiKey: 'sk-nano-67e8180b-57dc-444d-9c01-2d0f453d37ce'
};
