# AGENTS.md — Task Tracker

> Auto-maintained by Claude Code. Edit manually or via `/agents-md` commands.
> To resume after interruption: run `/agents-md resume` in a new session.

## Current Status

**Last Updated:** 2026-09-01
**Last Session Summary:** _Fixed the in-browser AI (LLM Chat 💬 + Agent Chat 🤖) which was erroring on shape requests: dead nano-gpt key in `web-config.js` + `ts/config.js` template **replacing** `OXVIEW_CONFIG` instead of merging (wiped model/key, left Agent Chat pointed at Apple floodgate). Now: keys only in gitignored `ts/config.js`, `web-config.js`/`config.example.js` carry none and use `Object.assign` merge, default model `z-ai/glm-5.3:thinking`, agent baseURL → nano-gpt, `max_tokens` 16000, empty-`content`→`reasoning` salvage. Added `shapes.star()`. New `ts/api/spatial_api.js` (`window.space`): live scene digest injected into both AI prompts, object-addressed transforms by name (`moveTo/moveBy/rotate/align/place/gap/overlaps`), reference grid + XYZ axes (`space.grid()`), inline snapshot images in chat (`space.show()`). Both AI prompts now document `shapes.*` + `space.*`. All changes mirrored to the NanoCanvas vendored copy._
**Resume From:** _AI works end-to-end (Playwright-verified: "draw a 3d star and show the output" → `shapes.star(...); space.show()` runs clean, image rendered). Open `http://localhost:8766/` (grid appears when a chat panel opens) or the embed at `/integration/nanocanvas_embed.html`. `ts/config.js` holds the live key and is gitignored — recreate it from `ts/config.example.js` on a fresh clone._

---

## Active Tasks

**None** - All implementation tasks completed successfully! 🎉

---

## Completed Tasks

| ID | Task | Completed |
|----|------|-----------|
| #0 | Initialize AGENTS.md tracker | 2026-06-12 22:00 |
| #1 | Document oxDNA-viewer API and architecture | 2026-06-12 22:00 |
| #2 | Document NanoCanvas API and architecture | 2026-06-12 22:00 |
| #3 | Create nucleotide/base add/remove APIs in oxDNA-viewer | 2026-06-12 23:15 |
| #4 | Map edit operations between oxDNA-viewer and NanoCanvas | 2026-06-12 22:05 |
| #5 | Design bidirectional ID mapping system | 2026-06-12 23:10 |
| #6 | Implement live-sync communication layer | 2026-06-12 23:20 |
| #7 | Integration: embed one tool in the other | 2026-06-12 23:25 |
| #8 | Testing and validation | 2026-06-12 23:28 |
| #9 | Create comprehensive documentation | 2026-06-12 23:30 |
| #10 | Browser web deployment, non-root Tailscale proxy, postMessage bridge, and unified LLM cross-tool integration | 2026-07-23 08:24 |

---

## Session Log

### 2026-09-01 — AI fix + spatial API

**Problem reported:** "draw a 3d star and show the final output" in the AI chat
returned an error. (The chat persists no logs — only browser console + the chat
DOM — so the failure was reproduced by testing the API directly.)

**Root causes**
1. `web-config.js` shipped nano-gpt key `sk-nano-67e8180b…` → now `401`.
2. `index.html` loads `web-config.js` then `ts/config.js`; the committed
   `ts/config.js` was the unfilled template and did `window.OXVIEW_CONFIG = {…}`
   — **replacing** the object: killed `llmApiKey`/`llmModel`, and Agent Chat fell
   back to `floodgate.g.apple.com` (Apple-internal) + empty key.
3. No `shapes.star()` — `shapes_api.js` had a `// SPIRAL / STAR` header only.
4. `llm_chat.js` `SYSTEM_PROMPT` never mentioned `shapes.*` / `llmTracker.*`
   (only `agent_chat.js` did) → 💬 chat hand-rolled from `edit.createStrand`.
5. `glm-5.2:thinking` puts the answer in `message.reasoning`, leaving `content`
   empty/truncated.

**Changes**
- **Config**: `web-config.js` + `ts/config.example.js` — no keys, `Object.assign`
  merge, `llmModel`/`agentModel` = `z-ai/glm-5.3:thinking`, `agentBaseURL` =
  nano-gpt. Live key lives ONLY in gitignored `ts/config.js` (merge form).
- **`ts/llm_chat.js` / `ts/agent_chat.js`**: config as getters (not frozen at
  load), missing-key guard, `max_tokens` → 16000, empty-`content`→`reasoning`
  salvage, `<think>` strip, `finish_reason:'length'` surfaced. `window.llmChat`
  / `window.agentChat` exported. Grid auto-on when a panel opens. `llm_chat.js`
  renders `space` snapshots inline and shows the scene digest after each run.
- **`ts/api/shapes_api.js`**: new `shapes.star(center, normal, outerR, innerR,
  numPoints, basesPerEdge, seq?, isRNA?, tag?)`.
- **`ts/api/spatial_api.js`** (new, `window.space`): `digest()`/`describe()`
  (centroid, bbox, size, PCA axis, colour per `llmTracker` tag / selection /
  untagged system), injected as a live `CURRENT SCENE` block into both AI
  prompts every turn; `get/centroid/bbox/size`, `moveTo/moveBy`,
  `rotate(name,axis,deg,pivot)`, `align(name,whichAxis,worldDir)`,
  `place(name,{near,dir,gap})`, `distance/gap/overlaps`, `snapshotImage()`,
  `show()`, `grid(on?)`/`toggleGrid()` (GridHelper + AxesHelper + sprite labels).
  All addressed by **name** so they survive the per-block `new Function()` scope
  reset. Loaded as a classic script after `shapes_api.js` (both `index.html`).
- **`integration/nanocanvas_embed.html`**: removed hardcoded key; Unified-AI
  config borrows key/model from the same-origin oxView iframe's `OXVIEW_CONFIG`.
- Both AI `SYSTEM_PROMPT`s now document `shapes.*` and `space.*` with examples.

**Verified** (Playwright, `:8766` and NanoCanvas `:5173/oxview/`): `window.space`
+ 18 methods, model = `z-ai/glm-5.3:thinking`, key present, grid toggles,
`shapes.star`/`place`/`gap`/`overlaps`/`snapshotImage` work, 0 JS errors.
End-to-end: the reported prompt now yields `shapes.star(...); space.show();`,
runs clean, star (60 nt) created, snapshot shown in chat.

**Note:** `ts/config.js` is gitignored — recreate from `ts/config.example.js`
(add your key) on a fresh clone. All edits mirrored to the NanoCanvas vendored
copy `cadnano-app/public/oxview/`.

### 2026-06-12

**Phase 1: Documentation & Analysis (21:55 - 22:05)**
- 21:55 Started: oxDNA-viewer + NanoCanvas live-sync integration project
- 21:55 Project scope: Create APIs for nucleotide/base manipulation + bidirectional live-editing sync
- 21:55 Task breakdown: 8 major tasks identified from documentation to integration
- 21:55 Launched parallel exploration agents for both codebases
- 21:56 Sent initial project kickoff update via Telegram
- 22:00 Completed NanoCanvas API analysis via knowledge graph query
- 22:00 Created comprehensive NanoCanvas API documentation (docs/NANOCANVAS_API.md)
- 22:00 Both exploration agents completed successfully with detailed reports
- 22:00 Created comprehensive oxDNA-Viewer API documentation (docs/OXDNA_VIEWER_API.md)
- 22:05 Created edit operations mapping document (docs/EDIT_OPERATIONS_MAP.md)
- 22:05 Analysis phase complete - ready for implementation

**Phase 2: Core Implementation (23:00 - 23:25)**
- 23:10 Created ID mapping system (ts/api/id_mapping.ts) - 350+ lines
  - Bidirectional oxView ↔ NanoCanvas lookup tables
  - Lattice coordinate transformations (honeycomb & square)
  - Position calculations and mappings
  - Export/import functionality
- 23:15 Created NanoCanvas Sync API (ts/api/nanocanvas_sync_api.ts) - 600+ lines
  - High-level operations: createHelix, createStrand, createCrossover
  - Single nucleotide add/remove/modify
  - Event emission system for WebSocket sync
  - State management and serialization
- 23:18 Created oxView WebSocket layer (ts/api/websocket_sync.ts) - 380+ lines
  - Auto-reconnecting WebSocket client
  - Message handlers for all sync events
  - Event forwarding and transformation
  - Status indicators and queuing
- 23:20 Created NanoCanvas WebSocket backend (backend/websocket_sync.py) - 350+ lines
  - FastAPI WebSocket endpoint handlers
  - Connection manager with broadcasting
  - Session state synchronization
  - Error handling and recovery
- 23:20 Integrated WebSocket endpoints into NanoCanvas app.py
  - Added /ws and /ws/{session_id} endpoints
  - Imported websocket_sync module

**Phase 3: Integration & Testing (23:22 - 23:30)**
- 23:22 Created integration HTML wrapper (integration/nanocanvas_embed.html)
  - Split-screen interface (3D + 2D views)
  - Draggable panel resizer
  - Sync controls and status indicators
  - Real-time bidirectional sync toggle
- 23:25 Created ID mapping test suite (tests/test_id_mapping.html)
  - 13 comprehensive unit tests
  - Visual test runner with pass/fail indicators
  - Coverage: lattice conversion, mappings, serialization
- 23:28 Created integration test suite (tests/integration_test.py)
  - 8 end-to-end WebSocket tests
  - Connection, state sync, operations
  - Performance and error handling tests
  - Colored terminal output
- 23:30 Created comprehensive documentation (docs/INTEGRATION_GUIDE.md)
  - Installation and setup instructions
  - API reference for all modules
  - Usage examples and workflows
  - Troubleshooting guide
  - Advanced usage patterns

**Project Complete! 🎉**
- **Total Implementation Time:** ~1.5 hours
- **Lines of Code:** ~2,500+ (TypeScript + Python + HTML)
- **Files Created:** 10 new files
- **Files Modified:** 2 files (NanoCanvas backend)
- **Test Coverage:** 21 automated tests
- **Documentation:** 4 comprehensive guides
