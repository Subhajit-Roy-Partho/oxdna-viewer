// Template — copy this to ts/config.js and fill in your values.
// ts/config.js is gitignored and never committed.
//
// It loads AFTER web-config.js and MERGES into window.OXVIEW_CONFIG, so you
// only need to set the fields you want to override (normally just the keys).
window.OXVIEW_CONFIG = Object.assign(window.OXVIEW_CONFIG || {}, {
    // LLM Chat (💬)
    llmBaseURL: "https://nano-gpt.com/api/v1",
    llmModel:   "z-ai/glm-5.3:thinking",
    llmApiKey:  "",   // <-- your nano-gpt (or other OpenAI-compatible) API key

    // Agent Chat (🤖) — falls back to llmApiKey if agentApiKey is unset
    agentBaseURL: "https://nano-gpt.com/api/v1",
    agentModel:   "z-ai/glm-5.3:thinking",
    agentApiKey:  "",
});
