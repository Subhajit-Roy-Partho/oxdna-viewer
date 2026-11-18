# oxView agent runtime and the NanoCanvas to viewer task handoff

Status: implemented and tested (2026-11-18). Viewer side: `oxdna-viewer/ts/api/agent_runtime.js`. NanoCanvas side:
`cadnano-app/src/editor/api/oxViewAiApi.js` (registered on `window.__CADNANO_AI__`) and the `MessageChannel` bridge in
`cadnano-app/src/editor/io/integrationMessages.js`. A copy of the viewer files is vendored in `cadnano-app/public/oxview`.

## Why

Before this change a NanoCanvas agent could push a design into the embedded viewer but could not ask the viewer anything
back, and the viewer's own LLM agent reported failures as the bare string `ERROR: <message>`. Both sides now share one
structured, awaited contract, so an agent sees *what* failed, *where*, and *what to try*, and can verify the result by
counting nucleotides and checking topology instead of assuming success.

## Contract

Everything in a result is JSON-safe (depth, node count and collection size are capped; large arrays are sliced before they are read). Requests are queued one at a time; a request that times out is reported as failed but its code is not cancelled, so it can still change the scene while the next request runs (inspect before retrying a mutation). The steps of a `task` are queued individually, not as one unit.

| Method | Result |
|---|---|
| `capabilities()` | `version`, `methods`, `limits`, which globals exist, the `api.*` function names, whether the viewer LLM is available and has a key (the key itself is never returned) |
| `inspect()` | `nucleotideCount`, `strandCount`, `systemCount`, per-system `{strands, monomers, rna, dna}`, `selectionCount` |
| `validate()` | `{ok, checked, links, counts, errors[]}`: reciprocal 3'/5' links, finite positions, element-count agreement (at most 25 errors listed) |
| `execute(code)` | `{ok, executed, value, logs[], scene:{before,after}, warnings[], error?, diagnostics?}`; async code is allowed |
| `task(text)` | headless viewer-LLM loop (planner, executor, structured run, observer, retry with the error text, summary) with every generated code block and run result |

An execution error carries `name`, `message`, `line`, `column`, the offending source line and a repair `hint`:

```json
{ "ok": false, "error": { "name": "ReferenceError", "message": "notAViewerFunction is not defined", "line": 2,
  "source": "notAViewerFunction(a);", "hint": "Only documented viewer globals exist ..." } }
```

Code that runs but leaves the topology inconsistent returns `ok: true` with a `TopologyWarning` in `warnings` (the run is
not retroactively failed, because the scene may already have been inconsistent).

## Transport

`window.postMessage({ type: "oxview_api_request", id, method, args }, origin, [port])`; the reply goes to `port`:
`{ id, ok: true, result }` or `{ id, ok: false, error, diagnostics: [{ code, message, hint }] }`. `ok: true` means the request was
handled; a failed task is reported inside `result` and NanoCanvas maps it to `ok: false` with `error` as a readable string
and the structured `result` kept. The viewer answers only the embedding parent frame (or itself) on the same origin;
other senders get `UntrustedSender`, unknown methods `UnknownMethod`.

## NanoCanvas side (`window.__CADNANO_AI__`)

`oxViewOpen`, `oxViewCapabilities`, `oxViewInspect`, `oxViewValidate`, `oxViewRun({code})`, `oxViewTask({task})` and
`ssoPushToOxView({mol})`, which exports the open ssRNA/ssDNA design, loads it in the viewer, waits until the viewer holds exactly
the expected number of nucleotides, and validates the topology. Transport success is kept distinct from task success. The
page-level `request_design` / `run_api` bridge answers each request once (it used to run two handlers per message), supports
async methods and `requestId` correlation, and ignores frames that are neither the page itself nor the embedded viewer.

## Tests

* Viewer unit test (stub scene): `node oxdna-viewer/tests/agent-runtime.test.mjs` (10 groups: inspect, validate, execute with structured
  errors, timeout, oversize code, serialisation, task retry with the error text, host protocol and trust checks).
* End to end in a real browser with the real embedded viewer, viewer LLM mocked (no provider is contacted):
  `npx playwright test -c playwright.ss.config.js tests/ss-viewer-bridge.spec.js` (4 specs: bridge, untrusted frame, nucleotide-exact
  handover plus return task, and the full inspect / validate / run / error / self-repairing task chain).

## Limits

* The viewer agent panel now treats an execution error as a failed step even if the observer model says success (before, the observer could overrule a thrown error); with no runtime loaded the code path is otherwise unchanged.
* `execute` cannot be cancelled: a timeout returns `ViewerTimeout` but the code may still finish, so inspect before retrying a mutation.
* `task` needs a configured viewer LLM key; without one it returns `ViewerLLMNotConfigured` and the caller should use `execute`.
* `validate` covers topology and positions, not physical plausibility (clashes, bond lengths).
* The vendored viewer in `public/oxview` was patched file by file (the new module, `index.html`, `agent_chat.js`, `llm_chat.js`); the rest of that copy is older than the viewer repository.
* The viewer's other `message` listeners (`drop`, `run_js`, `apply_diff`, the sync port) still do not check the sender's origin.
