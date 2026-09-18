# oxView Agent AI — Developer Reference

This document covers the multi-agent pipeline (`ts/agent_chat.js`) — how it works, why it is designed that way, how to configure it, and how to extend or debug it.

For the simpler single-turn LLM Chat, see `Agents.md`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture — The Four-Node Pipeline](#2-architecture--the-four-node-pipeline)
3. [File Location](#3-file-location)
4. [Request Lifecycle — Step by Step](#4-request-lifecycle--step-by-step)
5. [The Four Agents in Detail](#5-the-four-agents-in-detail)
   - 5.1 [Planner](#51-planner)
   - 5.2 [Executor](#52-executor)
   - 5.3 [Observer](#53-observer)
   - 5.4 [Summarizer](#54-summarizer)
6. [Retry Loop](#6-retry-loop)
7. [Code Execution](#7-code-execution)
8. [Configuration](#8-configuration)
9. [API Key Management](#9-api-key-management)
10. [UI — Stages, Panel, and Visual Feedback](#10-ui--stages-panel-and-visual-feedback)
11. [System Prompts Reference](#11-system-prompts-reference)
12. [Agent vs LLM Chat — When to Use Which](#12-agent-vs-llm-chat--when-to-use-which)
13. [Extending the Agent](#13-extending-the-agent)
14. [Debugging Guide](#14-debugging-guide)
15. [Known Limitations](#15-known-limitations)

---

## 1. Overview

The Agent AI is a **multi-agent pipeline** that decomposes complex natural-language tasks into sequential steps and executes each one with automatic error recovery.

Unlike the simpler LLM Chat (which fires one API call and runs the returned code directly), the Agent uses **four specialised language models** in series — a Planner, an Executor, an Observer, and a Summarizer — each with a different system prompt and responsibility. If a step fails, the Observer feeds back targeted guidance and the Executor retries up to three times before giving up.

The design is inspired by LangGraph-style pipelines but is implemented in ~500 lines of vanilla JavaScript with no external libraries.

---

## 2. Architecture — The Four-Node Pipeline

```
User task
    │
    ▼
┌─────────────────────────────────────┐
│  PLANNER                            │
│  Decomposes task into 1–5 steps     │
│  Returns: JSON string[]             │
└───────────────┬─────────────────────┘
                │  steps[]
                ▼
    ┌───────────────────────────────┐
    │  for each step:               │
    │                               │
    │  ┌─────────────────────────┐  │
    │  │  EXECUTOR               │  │
    │  │  Writes JavaScript      │  │
    │  │  Returns: code string   │  │
    │  └──────────┬──────────────┘  │
    │             │ code            │
    │             ▼                 │
    │       run code in browser     │
    │       → "SUCCESS" or "ERROR:" │
    │             │                 │
    │             ▼                 │
    │  ┌─────────────────────────┐  │
    │  │  OBSERVER               │  │
    │  │  Verifies the result    │  │
    │  │  Returns: {success,     │  │
    │  │            feedback}    │  │
    │  └──────────┬──────────────┘  │
    │             │                 │
    │    success? ├──YES──► next step│
    │             │                 │
    │    NO + retries left?         │
    │             └──► back to      │
    │                  EXECUTOR     │
    │                  (with        │
    │                  feedback)    │
    └───────────────────────────────┘
                │  stepResults[]
                ▼
┌─────────────────────────────────────┐
│  SUMMARIZER                         │
│  Writes a human-readable summary    │
│  Returns: plain text string         │
└─────────────────────────────────────┘
```

Every box is a separate HTTP request to the LLM API. A five-step task with one retry on step three costs **4 + (2+1) + 1 = 8 API calls** total.

---

## 3. File Location

```
ts/agent_chat.js      ← the entire agent pipeline (plain JS, not compiled)
```

Like `ts/llm_chat.js`, this file is **not** processed by TypeScript. It is loaded directly by `index.html` as a `<script>` tag, after all compiled viewer scripts. This ensures every viewer global (`edit`, `api`, `systems`, `render`, etc.) is in scope before any agent code runs.

---

## 4. Request Lifecycle — Step by Step

### 1. User submits a task

The user types in `#agent-chat-input` and presses Enter (or clicks Send). `agentChat.run()` is called.

### 2. Planner call

`agentPlanner(task)` sends one API call with `PLANNER_SYSTEM` as the system prompt and the user's task as the user message. The model returns a JSON array of step strings.

```javascript
// Example planner output for "colour the first strand red and zoom to it"
["Select all nucleotides in strand 0 of system 0",
 "Colour the selected nucleotides red",
 "Fly the camera to the first selected element"]
```

The code extracts the JSON array with a regex (`/\[[\s\S]*?\]/`) in case the model adds surrounding prose.

### 3. Execute → Observe loop (per step)

For each step string:

1. `agentExecutor(step, retryContext)` sends one API call with `EXECUTOR_SYSTEM`. It returns raw JavaScript. Markdown fences are stripped if present.
2. The code is run immediately: `(new Function(lastCode))()`.
3. If the code throws, `execResult` is set to `"ERROR: <message>"`. Otherwise it is `"SUCCESS"`.
4. `agentObserver(step, code, execResult)` sends one API call with `OBSERVER_SYSTEM`. It returns `{success: bool, feedback: string}`.
5. If `success` is `true`, the pipeline moves to the next step.
6. If `success` is `false` and retries remain, `observation.feedback` becomes `retryContext` for the next Executor call. This tells the model exactly what went wrong.
7. After `AGENT_MAX_RETRIES` (= 3) failed attempts, the step is marked as failed and the pipeline continues to the next step (it does not abort).

### 4. Summarizer call

After all steps, `agentSummarizer(task, stepResults)` sends one final API call with `SUMMARIZER_SYSTEM`. It receives the task and a list of which steps succeeded or failed, and returns a 1–3 sentence plain-text summary shown to the user.

---

## 5. The Four Agents in Detail

### 5.1 Planner

**System prompt constant:** `PLANNER_SYSTEM`

**Input:** The raw user task string.

**Output:** A JSON array of 1–5 step description strings. No markdown, no explanation.

**Design notes:**
- Capped at 5 steps to keep the pipeline cheap and fast. Single-action tasks should produce exactly 1 step.
- Each step is phrased as a concrete imperative ("Select all nucleotides in system 0") so the Executor has a clear, unambiguous instruction.
- Steps are ordered so each builds on the previous — e.g. "Select elements" comes before "Colour elements".

**What can go wrong:**
- Returns prose instead of JSON → the regex match fails and a `Planner returned non-JSON` error is thrown, aborting the pipeline.
- Returns more than 5 steps → all steps are executed; the cap is a guideline in the prompt, not enforced in code.

---

### 5.2 Executor

**System prompt constant:** `EXECUTOR_SYSTEM`

**Input:** A single step description string. On retries: the same string plus a `retryContext` block containing the Observer's fix guidance from the previous attempt.

**Output:** Raw JavaScript code. Must end with `render();`.

The Executor's system prompt includes the **complete viewer API reference** (the same surface as the LLM Chat system prompt, condensed for the Executor role):
- Global state variables
- `api.*` visualization functions
- `edit.*` editing functions
- Global transform functions (`translateElements`, `rotateElements`, `rotateElementsByQuaternion`)
- System and element methods
- UI helpers
- Several common code patterns (move to position, rotate around COM, etc.)

**Design notes:**
- `temperature: 0.1` keeps outputs deterministic across retries.
- The Executor only handles **one step at a time** — this is intentional. Smaller scope = less hallucination.
- On retry, `retryContext` is appended as a "Previous attempt failed — fix guidance:" block. This lets the model correct a specific mistake rather than regenerating from scratch.

---

### 5.3 Observer

**System prompt constant:** `OBSERVER_SYSTEM`

**Input:** The step description, the code that was run, and the execution result (`"SUCCESS"` or `"ERROR: <message>"`).

**Output:** A JSON object: `{"success": true, "feedback": "brief note"}` or `{"success": false, "feedback": "specific guidance on how to fix"}`.

**Design notes:**
- The Observer acts as a **quality gate**. Even if the code ran without throwing, the Observer can return `success: false` if the step clearly could not have worked (e.g. the wrong function name was used).
- Feedback is capped at 120 characters — enough to be actionable, short enough to fit into the Executor's retry prompt without polluting it.
- If the Observer API call itself fails, the pipeline falls back to: `success = (execResult === 'SUCCESS')`, so a network hiccup does not abort the task.

**The Observer's fallback logic in code:**
```javascript
try {
    observation = await agentObserver(step, lastCode, execResult);
} catch (_) {
    observation = { success: execResult === 'SUCCESS', feedback: 'Verification unavailable' };
}
```

---

### 5.4 Summarizer

**System prompt constant:** `SUMMARIZER_SYSTEM`

**Input:** The original task and a list of `"Step N: '<description>' — succeeded/failed"` lines.

**Output:** 1–3 sentences of plain text, no markdown. Mentions what changed in the molecular structure and flags any failed steps.

**Design notes:**
- The Summarizer is purely informational — it does not execute any code.
- It only fires once, after all steps complete (or fail), so its cost is always exactly one API call regardless of how many retries occurred.

---

## 6. Retry Loop

The retry logic is the key difference between the Agent and the simpler LLM Chat.

```javascript
const AGENT_MAX_RETRIES = 3;

for (let attempt = 0; attempt < AGENT_MAX_RETRIES; attempt++) {
    // Generate code (with fix guidance if attempt > 0)
    lastCode = await agentExecutor(step, attempt > 0 ? retryContext : '');

    // Run the code
    let execResult = 'SUCCESS';
    try {
        (new Function(lastCode))();
        if (typeof render === 'function') render();
    } catch (execErr) {
        execResult = `ERROR: ${execErr.message}`;
    }

    // Evaluate
    const observation = await agentObserver(step, lastCode, execResult);

    if (observation.success) {
        success = true;
        break;                          // move to next step
    } else {
        retryContext = observation.feedback;  // feed error info back into next attempt
        if (attempt === AGENT_MAX_RETRIES - 1) {
            // mark step as failed, continue pipeline
        }
    }
}
```

The Observer's `feedback` string is passed back to the Executor as `retryContext`. This creates a tight correction loop:

```
Attempt 1 → "edit.extendStrand is not a function"
Observer  → "Use edit.extendDuplex for double-stranded extension"
Attempt 2 → uses edit.extendDuplex → SUCCESS
```

A failed step does **not** abort the entire pipeline. Remaining steps still run, and the Summarizer reports which steps failed.

---

## 7. Code Execution

Generated JavaScript is run with:

```javascript
(new Function(lastCode))();
if (typeof render === 'function') render();
```

**Why `new Function` instead of `eval`:** `eval()` captures the local closure scope. Inside an `async` function, variables defined outside (like `edit`, `api`, `systems`) may not be visible. `new Function(code)` always creates a function in the **global scope** — equivalent to a `<script>` block — so all viewer globals are unconditionally accessible.

**Why an explicit `render()` call:** Editing functions update internal typed arrays (instance matrices, colours) but do not trigger a THREE.js repaint. The model is instructed to end code with `render();`, and the pipeline also calls it explicitly after execution as a safety net.

**Error capture:** Any `throw` from the generated code is caught, converted to `"ERROR: <message>"`, and passed to the Observer. The full error and code are also written to `console.error` for browser-console debugging.

---

## 8. Configuration

All agent settings are in the `AGENT_CONFIG` object at the top of `ts/agent_chat.js`:

```javascript
const AGENT_CONFIG = {
    baseURL: (window.OXVIEW_CONFIG || {}).agentBaseURL || "https://floodgate.g.apple.com/api/openai/v1",
    model:   (window.OXVIEW_CONFIG || {}).agentModel   || "aws:anthropic.claude-3-5-haiku-20241022-v1:0",
    get apiKey() {
        return localStorage.getItem('oxview_agent_api_key')
            || (window.OXVIEW_CONFIG || {}).llmApiKey
            || '';
    }
};

const AGENT_MAX_RETRIES = 3;
```

**To change via config file (recommended):** edit `ts/config.js`:

```javascript
window.OXVIEW_CONFIG = {
    agentBaseURL: "https://nano-gpt.com/api/v1",
    agentModel:   "moonshotai/kimi-k2.6:thinking",
    llmApiKey:    "sk-nano-..."
};
```

`ts/config.js` is gitignored and never committed. See `ts/config.example.js` for a template.

**API key priority (highest to lowest):**
1. `localStorage['oxview_agent_api_key']` — set at runtime via the key button in the panel
2. `window.OXVIEW_CONFIG.llmApiKey` — set in `ts/config.js`
3. Empty string → pipeline errors with `NO_KEY` on first API call

**To change the retry limit:** edit `AGENT_MAX_RETRIES`. Setting it to `1` disables retries.

**To change temperature or max tokens:** edit the `body` object inside `agentApiCall()`.

---

## 9. API Key Management

The panel has a key (🔑) button that calls `agentChat.setApiKey()`:

```javascript
setApiKey() {
    const input = prompt('Enter your API key. Leave blank to clear.');
    if (input === null) return;
    if (input.trim()) {
        localStorage.setItem('oxview_agent_api_key', input.trim());
    } else {
        localStorage.removeItem('oxview_agent_api_key');
    }
    this._updateKeyStatus();
}
```

The key is stored in `localStorage` under `'oxview_agent_api_key'`. It persists across sessions. The panel header shows `🔑 Key: …XXXX` (last 4 chars) when a key is set, or `🔑 No key set` in red when it is not.

**Error surfacing:**
- `401` / `403` → `AUTH_ERROR: API key invalid or unauthorized`
- `429` → `QUOTA_ERROR: Rate-limited or quota exhausted`
- Both errors append a second message directing the user to check their account.

---

## 10. UI — Stages, Panel, and Visual Feedback

### Stage indicator

Four stage badges are shown in the panel header: **Planner · Executor · Observer · Summarizer**. The currently active stage is highlighted with an `.active` CSS class via `agentChat._setStage(stage)`. The stage resets to `null` when the pipeline finishes.

### Message types

| CSS class | Colour | Used for |
|---|---|---|
| `agent-msg-user` | Blue | User task |
| `agent-msg-planner` | Purple | Plan header |
| `agent-msg-planner-step` | Light purple | Individual plan steps |
| `agent-msg-executor` | Yellow | "Generating code…" status |
| `agent-msg-code` | Gold monospace | Generated JavaScript |
| `agent-msg-observer` | Teal | Observer feedback |
| `agent-msg-success` | Green | "✅ Step verified" |
| `agent-msg-warning` | Orange | Observer said failure |
| `agent-msg-error` | Red | Errors and failures |
| `agent-msg-summary` | White | Final summary |
| `agent-msg-divider` | Grey | "── Step N / M ──" separator |
| `agent-msg-system` | Grey italic | System notices |

### Concurrency guard

`agentChat.isRunning` is set to `true` at the start of `run()` and reset in `finally`. Calling `run()` again while a task is in progress is a no-op, preventing overlapping pipelines.

---

## 11. System Prompts Reference

All four prompts are defined as `const` strings near the top of `ts/agent_chat.js`.

### `PLANNER_SYSTEM` (lines ~125–137)

Instructs the model to return **only a JSON array** of 1–5 imperative step strings. Includes an example input/output pair. No markdown, no explanation.

### `EXECUTOR_SYSTEM` (lines ~139–161)

Instructs the model to return **only valid JavaScript** ending with `render();`. Contains the full viewer API reference (`AGENT_VIEWER_API` constant, lines ~29–119) plus six common code patterns for the most frequently needed operations.

The `AGENT_VIEWER_API` block is shared across both the Executor and any other agent that needs to understand the viewer surface. It covers:
- Global state variables (`systems`, `elements`, `selectedBases`, `box`, `scene`, `camera`, `editHistory`)
- `api.*` — all visualization and selection functions
- `edit.*` — all structure editing functions
- Global transform functions
- System, Strand, and BasicElement methods
- UI helpers

### `OBSERVER_SYSTEM` (lines ~163–178)

Instructs the model to return **only a JSON object** `{success, feedback}`. Clear rules: if the result is `"SUCCESS"`, return `success:true` unless the step obviously could not have worked; if the result starts with `"ERROR:"`, return `success:false` with targeted fix guidance. Feedback is capped at 120 characters.

### `SUMMARIZER_SYSTEM` (lines ~180–183)

Instructs the model to write **1–3 sentences** of plain text. Be friendly, be specific about structural changes, mention failures. No markdown.

---

## 12. Agent vs LLM Chat — When to Use Which

| | LLM Chat (`ts/llm_chat.js`) | Agent AI (`ts/agent_chat.js`) |
|---|---|---|
| **Best for** | Quick, single-action commands | Multi-step, complex tasks |
| **API calls per task** | 1 | 4 – 16+ |
| **Retry on failure** | No | Yes — up to 3 per step |
| **Multi-turn memory** | Yes — history accumulates | No — each task is stateless |
| **Error recovery** | Shows error, no correction | Observer feeds fix guidance back |
| **Cost** | Cheap | More expensive |
| **Speed** | Fastest | Slower (4 serial round trips minimum) |
| **Example task** | "Select all strands and colour them blue" | "Create a 20-bp duplex, rotate it 45°, then connect it to the existing structure" |

---

## 13. Extending the Agent

### Adding new viewer API functions to the Executor

1. Open `ts/agent_chat.js`.
2. Find the `AGENT_VIEWER_API` constant (~line 29).
3. Add the new function under the appropriate section heading:

```
api.myNewFunction(arg1: type, arg2: type)   → returnType
    What it does in one line.
    Example: api.myNewFunction(systems[0], 42);
```

4. If the function is prone to misuse, add a "DO NOT" note, e.g.:
   `// DO NOT call api.myNewFunction with a Strand — it expects a System.`

### Adding a new common code pattern

Append a template to the COMMON PATTERNS section of `EXECUTOR_SYSTEM`. Follow the existing format: a `//` comment explaining what it does, then the complete runnable block.

### Changing the number of plan steps

Edit `PLANNER_SYSTEM`. The `Maximum 5 steps` rule is enforced by the prompt, not by code. You can raise or lower it.

### Adding a fifth agent (e.g. a Validator)

1. Define a new `VALIDATOR_SYSTEM` prompt constant.
2. Call `agentApiCall(VALIDATOR_SYSTEM, ...)` at the appropriate point in `agentChat.run()`.
3. Add a `'validator'` stage to `_setStage` and the stage indicator HTML.

---

## 14. Debugging Guide

### "Planning failed: Planner returned non-JSON"

The model returned prose instead of a raw JSON array. Causes:
- Model is wrapping its answer in explanation text.
- The model does not follow the JSON-only instruction.

Fixes:
- Switch to a more instruction-following model.
- Strengthen `PLANNER_SYSTEM`: add `"IMPORTANT: Output ONLY the JSON array. Any other text will break the system."`

### Step runs but nothing changes in the viewport

- The code executed without throwing but `render()` was not called in the generated code.
- The explicit `render()` in the pipeline should catch this. If it does not, check the browser console for silent errors.
- Confirm `dist/scene/scene_setup.js` exports `render` to `window`.

### "edit is not defined" / "api is not defined"

- The viewer globals are not in scope when `new Function(code)()` runs.
- Check that `dist/api/editing_api.js` and `dist/api/scene_api.js` are loaded before `ts/agent_chat.js` in `index.html`.
- Confirm these files expose their objects on `window` (e.g. `window.edit = edit;` or `var edit = ...` at the top level).

### Observer always returns `success: false`

- The Observer prompt may be too strict.
- Check `OBSERVER_SYSTEM` — the rule is "if the result is SUCCESS, return success:true unless the step clearly could not have worked." If this is being violated, the model may need a stronger instruction or an example.
- As a quick workaround, you can bypass the Observer by hardcoding `observation = { success: execResult === 'SUCCESS', feedback: '' }`.

### All retries fail for the same step

- Check the Observer's `feedback` in the chat log — it should contain actionable guidance.
- If the feedback is vague ("the code didn't work"), the Observer prompt needs better examples.
- If the feedback is correct but the Executor ignores it, the Executor may not be reading the retry context. Confirm `retryContext` is non-empty and appears in the user message passed to `agentApiCall`.

### AUTH_ERROR / QUOTA_ERROR

- `401`/`403`: the API key is wrong or expired. Use the 🔑 button to set a fresh key.
- `429`: rate limit or quota exhausted. Check the nano-gpt account dashboard.
- Test the key independently:

```bash
curl -X POST https://nano-gpt.com/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k2.6:thinking","messages":[{"role":"user","content":"say hi"}],"max_tokens":10}'
```

### Pipeline hangs / spinner never stops

- One of the four `await agentApiCall(...)` calls is not returning.
- Open Network tab in DevTools and look for a pending request to `/chat/completions`.
- Add a `signal: AbortSignal.timeout(30000)` to the `fetch` call inside `agentApiCall` to enforce a 30-second timeout.

---

## 15. Known Limitations

| Limitation | Detail |
|---|---|
| No streaming | All four agents are awaited fully before their results are shown. Streaming would require `text/event-stream` handling inside `agentApiCall`. |
| Steps are stateless | Each Executor call has no memory of previous steps' code. If step 3 needs to know what element ID step 1 created, the model must re-derive it from global state rather than reading a variable. |
| Max retries is a hard stop | After 3 failed attempts, the step is skipped. There is no mechanism to ask the user for clarification mid-pipeline. |
| `new Function` security | Arbitrary JavaScript runs in the page's global scope. Acceptable for a local desktop/lab tool; unsafe if the page is ever exposed to untrusted users. |
| API cost scales with plan length and retries | A five-step task with two retries can consume 13+ API calls. For cost-sensitive deployments, consider lowering `AGENT_MAX_RETRIES` or using a cheaper model for the Observer and Summarizer. |
| No undo grouping | The Agent may execute several edit operations. Each is individually undoable via Ctrl+Z, but there is no "undo the entire agent task" operation. |

---

*Last updated: 2026-05-13. File: `ts/agent_chat.js`.*
