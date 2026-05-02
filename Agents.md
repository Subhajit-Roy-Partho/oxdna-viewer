# oxView AI Agent — Developer Reference

This document is a complete reference for the LLM-powered AI chat interface built into oxView. It covers architecture, the full API surface exposed to the model, how code is executed, how to extend or debug the system, and worked examples.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [File Layout](#2-file-layout)
3. [How It Works — Request Lifecycle](#3-how-it-works--request-lifecycle)
4. [LLM Configuration](#4-llm-configuration)
5. [System Prompt Design](#5-system-prompt-design)
6. [Code Execution Model](#6-code-execution-model)
7. [Full API Reference](#7-full-api-reference)
   - 7.1 [Global State Variables](#71-global-state-variables)
   - 7.2 [api.* — Scene & Visualization](#72-api--scene--visualization)
   - 7.3 [edit.* — Structure Editing](#73-edit--structure-editing)
   - 7.4 [Global Transform Functions](#74-global-transform-functions)
   - 7.5 [System and Element Methods](#75-system-and-element-methods)
   - 7.6 [Observable API](#76-observable-api)
   - 7.7 [UI Helper Functions](#77-ui-helper-functions)
   - 7.8 [File I/O Globals](#78-file-io-globals)
8. [Common Patterns & Code Templates](#8-common-patterns--code-templates)
9. [UI Integration](#9-ui-integration)
10. [Extending the System Prompt](#10-extending-the-system-prompt)
11. [Debugging Guide](#11-debugging-guide)
12. [Known Limitations](#12-known-limitations)
13. [LLM Branch Background](#13-llm-branch-background)

---

## 1. Architecture Overview

```
User types natural language
        │
        ▼
llmChat.sendMessage()          [ts/llm_chat.js]
        │
        ▼
POST /chat/completions          [nano-gpt.com/api/v1]
  model: zai-org/glm-5.1:thinking
  messages: [system_prompt, ...conversation_history]
        │
        ▼
Response { content, reasoning } 
  content  → JavaScript code string (sometimes wrapped in ```js...```)
  reasoning → model's internal chain-of-thought (shown as 💭 excerpt)
        │
        ▼
Strip markdown fences if present
        │
        ▼
(new Function(code))()          Execute in global scope
        │
        ▼
render()                        Force THREE.js repaint
```

The model is given a detailed system prompt listing every available function. It returns **only JavaScript** which is immediately executed in the browser's global window scope — the same scope where `edit`, `api`, `systems`, `translateElements`, `render`, etc. all live.

---

## 2. File Layout

```
oxdna-viewer/
├── ts/
│   ├── llm_chat.js            ← AI chat UI + API call + code execution
│   ├── api/
│   │   ├── scene_api.ts       ← api.* namespace (visualization)
│   │   ├── editing_api.ts     ← edit.* namespace (structure editing)
│   │   ├── observable_api.ts  ← api.observable.* (CMS, Track, MeanOrientation)
│   │   └── plugin_api.ts      ← plugin loading/saving
│   ├── editing/
│   │   └── translation.ts     ← translateElements, rotateElements (globals)
│   ├── model/
│   │   ├── system.ts          ← System class
│   │   ├── nucleotide.ts      ← DNANucleotide / RNANucleotide
│   │   └── ...
│   ├── UI/
│   │   └── UI.ts              ← view, flux, notify, colorElements, etc.
│   ├── main.ts                ← systems[], elements, editHistory, box, render()
│   └── scene/
│       └── scene_setup.ts     ← render(), scene, camera
├── dist/                      ← compiled JavaScript (auto-generated from ts/)
├── index.html                 ← adds AI Chat tab, floating panel, loads llm_chat.js
├── Agents.md                  ← this file
└── LLM/
    ├── alpaca_dataset.jsonl   ← fine-tuning dataset (10 809 instruction–output pairs)
    ├── generate_dataset.py    ← generates the dataset programmatically
    ├── filter_dataset.py      ← filters & deduplicates dataset entries
    ├── select_verification_commands.py ← picks representative test commands
    ├── verification_commands.json      ← curated test commands
    ├── notWorking.json        ← commands that failed verification
    └── extract_ts_info.py     ← extracts TypeScript function signatures for dataset
```

**Important:** `ts/llm_chat.js` is **not** compiled by TypeScript — it is plain ES2015+ JavaScript loaded directly by `index.html`. All other files in `ts/` are compiled to `dist/` via `tsc`.

---

## 3. How It Works — Request Lifecycle

### Step 1 — User Input
The user types into `#llm-chat-input` and presses Enter (or clicks Send). `llmChat.sendMessage()` is called.

### Step 2 — History Management
The conversation history (`llmChat.history`) is an array of `{role, content}` objects. Each user message is pushed with `role: 'user'` before the API call. The system prompt is prepended fresh each request (not stored in history) to avoid context drift.

### Step 3 — API Call
A `fetch` POST is sent to `https://nano-gpt.com/api/v1/chat/completions` with:
- `model`: `zai-org/glm-5.1:thinking`
- `messages`: `[{role:'system', content: SYSTEM_PROMPT}, ...llmChat.history]`
- `temperature`: `0.1` (low = deterministic, consistent code generation)
- `max_tokens`: `1024`

The nano-gpt API is OpenAI-compatible. The `zai-org/glm-5.1:thinking` model is a reasoning model — it returns both a `content` field (the answer) and a `reasoning` field (its chain-of-thought).

### Step 4 — Response Parsing
```javascript
const rawContent = msg.content || '';
let code = rawContent.trim();
const codeBlockMatch = code.match(/^```[a-z]*\n?([\s\S]*?)```$/);
if (codeBlockMatch) code = codeBlockMatch[1].trim();
```
If the model wraps output in triple-backtick fences the regex strips them. The extracted string is pure JavaScript.

### Step 5 — Execution
```javascript
(new Function(code))();
if (typeof render === 'function') render();
```
`new Function(code)` creates a function in the **global** scope (unlike `eval()` which captures the local closure scope). This ensures `edit`, `api`, `systems`, `translateElements`, `render`, etc. are always reachable. An explicit `render()` is called afterwards because several editing functions (e.g. `edit.createStrand`) update instance arrays but do not trigger a THREE.js repaint themselves.

### Step 6 — Display
- The reasoning excerpt (first 150 chars) is shown as a `💭` system message.
- The extracted code is shown in a gold monospace bubble prefixed with `▶`.
- Any runtime error from step 5 is caught and shown as a red error bubble.

---

## 4. LLM Configuration

All configuration lives at the top of `ts/llm_chat.js`:

```javascript
const LLM_CONFIG = {
    baseURL: "https://nano-gpt.com/api/v1",
    model:   "zai-org/glm-5.1:thinking",
    apiKey:  "sk-nano-74ab9a6a-b1f8-4d34-bec2-d413387c20b6"
};
```

**To swap the model:** change `model` to any OpenAI-compatible model string (e.g. `"gpt-4o"`, `"claude-3-5-sonnet-20241022"` via a compatible gateway).

**To change temperature or token limit:** edit the `body` object inside `sendMessage()`.

**To use a different API provider:** change `baseURL` to any OpenAI-compatible endpoint and update the API key. The request/response format is standard OpenAI.

---

## 5. System Prompt Design

The system prompt (`SYSTEM_PROMPT` constant in `ts/llm_chat.js`) teaches the model the complete API surface. It is structured in clearly separated sections using Unicode box-drawing characters for visual separation that survives tokenization:

```
════ GLOBAL STATE ════
  lists every global variable with its type

════ api.* ════
  every api.xxx() function with signature and example

════ edit.* ════
  every edit.xxx() function with signature and example

════ GLOBAL TRANSFORM FUNCTIONS ════
  translateElements, rotateElements, rotateElementsByQuaternion

════ SYSTEM & ELEMENT METHODS ════
  .getMonomers(), .getPos(), .strand, .pair, .n3, .n5, etc.

════ OBSERVABLES ════
  CMS, Track, MeanOrientation

════ UI HELPERS ════
  notify(), ask(), colorElements(), view.*, resetScene(), etc.

════ COMMON PATTERNS ════
  copy-pasteable code blocks for the most frequent tasks
```

**Design principles:**
- Every function that could be confused with a THREE.js or browser API is disambiguated.
- The most error-prone pattern (moving elements — which requires `translateElements` + center-of-mass math, NOT `system.position.set`) is shown with a complete, runnable template.
- The prompt ends with `render();` reminder and over a dozen complete worked examples so the model can pattern-match.

---

## 6. Code Execution Model

### Why `new Function()` instead of `eval()`

`eval()` inside an async closure captures the closure's local scope. If a variable is not in that closure, `eval` cannot see it even if it is on `window`. `new Function(code)` always runs in the global scope — equivalent to code in a `<script>` tag — so all of the viewer's globals (`edit`, `api`, `systems`, `translateElements`, `render`, `THREE`, etc.) are unconditionally accessible.

### Why explicit `render()` after execution

THREE.js only repaints when `render()` is called. The editing functions update internal typed arrays (instance matrices, colors, etc.) but most do not call `render()` themselves. The explicit post-execution call guarantees the viewport always updates regardless of what the model generates.

### Error handling

Errors from the API call (network, 4xx/5xx) and from code execution are caught separately:

```javascript
// API errors
if (!response.ok) throw new Error(`API error ${response.status}: ${err}`);

// Execution errors
try {
    (new Function(code))();
    if (typeof render === 'function') render();
} catch (execErr) {
    this.renderMessage('error', 'Execution error: ' + execErr.message);
    console.error('LLM eval error:', execErr, '\nCode:', code);
}
```

The full error and the generated code are logged to the browser console to aid debugging.

---

## 7. Full API Reference

### 7.1 Global State Variables

These variables are always available in generated code.

| Variable | Type | Description |
|---|---|---|
| `systems` | `System[]` | All loaded systems. `systems[0]` is the first. |
| `elements` | `ElementMap` | `Map<id, BasicElement>` of every element. |
| `selectedBases` | `Set<BasicElement>` | Currently selected elements. |
| `box` | `THREE.Vector3` | Simulation box dimensions. |
| `scene` | `THREE.Scene` | The THREE.js scene. |
| `camera` | `THREE.Camera` | Active camera. |
| `editHistory` | `EditHistory` | Undo/redo stack. |
| `clusterCounter` | `number` | Auto-incremented when a new cluster is created. |
| `tmpSystems` | `System[]` | Scratch systems used during editing. |
| `forceHandler` | `ForceHandler` | Manages external forces. |
| `THREE` | `object` | The entire THREE.js library. |

---

### 7.2 `api.*` — Scene & Visualization

Defined in `ts/api/scene_api.ts`, compiled to `dist/api/scene_api.js`.

#### `api.getElements(ids: number[]): BasicElement[]`
Returns an array of `BasicElement` objects for the given numeric IDs.
```javascript
var e = api.getElements([0, 1, 2]);
```

#### `api.selectElementIDs(ids: number[], keepPrevious?: boolean): void`
Selects elements by ID. Pass `true` to add to the existing selection.
```javascript
api.selectElementIDs([5, 6, 7]);          // replace selection
api.selectElementIDs([10, 11], true);     // add to selection
```

#### `api.selectElements(elems: BasicElement[], keepPrevious?: boolean): void`
Selects an array of `BasicElement` objects directly.
```javascript
api.selectElements(systems[0].getMonomers());
```

#### `api.selectPDBIDs(nums: number[], chains?: string[], keepPrevious?: boolean): void`
Selects by PDB residue number and optionally by chain ID letter.
```javascript
api.selectPDBIDs([1, 2, 3], ['A']);
```

#### `api.findElement(element: BasicElement, steps?: number): void`
Smoothly animates the camera to centre on the given element. `steps` controls animation frames (default ~60).
```javascript
api.findElement(api.getElements([42])[0]);
```

#### `api.highlight5ps(system?: System): void`
Colours the 5' terminal nucleotide of every strand in the system (defaults to `systems[0]`).
```javascript
api.highlight5ps(systems[0]);
```

#### `api.highlight3ps(system?: System): void`
Same as above but for 3' terminals.

#### `api.update3primeMarkers(diameter: number, length: number, spacing: number): void`
Resizes the cone geometry drawn at every 3' end.
```javascript
api.update3primeMarkers(0.3, 1.0, 0.1);
```

#### `api.toggleStrand(strand: Strand): Strand`
Toggles the visibility of one strand and returns it.
```javascript
api.toggleStrand(systems[0].strands[0]);
```

#### `api.toggleElements(elems: BasicElement[]): void`
Toggles visibility of an arbitrary list of elements.
```javascript
api.toggleElements(api.getElements([0, 1, 2]));
```

#### `api.toggleAll(system?: System): void`
Toggles visibility of every element in a system.
```javascript
api.toggleAll(systems[0]);
```

#### `api.toggleBaseColors(): void`
Switches nucleoside colouring between the element's assigned colour and a neutral grey. Useful for spotting sequence patterns.

#### `api.countStrandLength(system?: System): { [len: number]: Strand[] }`
Returns a dictionary mapping strand length → array of strands with that length.
```javascript
var counts = api.countStrandLength(systems[0]);
console.log(counts);
```

#### `api.trace53(element: BasicElement): BasicElement[]`
Walks 5'→3' from the given element and returns all elements in that direction.
```javascript
var path = api.trace53(api.getElements([0])[0]);
```

#### `api.trace35(element: BasicElement): BasicElement[]`
Walks 3'→5' from the given element.

#### `api.switchCamera(): void`
Toggles between Perspective and Orthographic camera projections.

#### `api.setBackgroundColor(color: string): void`
Sets the canvas CSS background. Accepts any CSS colour string.
```javascript
api.setBackgroundColor('#1a1a2e');
api.setBackgroundColor('white');
```

#### `api.showColorbar(): void` / `api.removeColorbar(): void`
Show or hide the colorbar overlay (used when a scalar observable is mapped to colour).

#### `api.changeColormap(name: string): void`
Switch the active colormap. Available names (from Lut.js):
`rainbow`, `cooltowarm`, `blackbody`, `grayscale`, `viridis`, `plasma`, `inferno`, `magma`, `cividis`, `Greys`, `Purples`, `Blues`, `Greens`, `Oranges`, `Reds`, `YlOrBr`, `YlOrRd`, `OrRd`, `PuRd`, `RdPu`, `BuPu`, `GnBu`, `PuBu`, `YlGnBu`, `PuBuGn`, `BuGn`, `YlGn`.

#### `api.setColorBounds(min: number, max: number): void`
Sets the numeric range that maps onto the colormap.
```javascript
api.setColorBounds(0, 100);
```

#### `api.showEverything(): void`
Restores all elements to visible and resets component scales to their defaults.

---

### 7.3 `edit.*` — Structure Editing

Defined in `ts/api/editing_api.ts`, compiled to `dist/api/editing_api.js`. All editing operations are undoable via `editHistory`.

#### `edit.createStrand(sequence: string, createDuplex?: boolean, isRNA?: boolean): BasicElement[]`
Creates a new strand from a base sequence.
- `sequence`: string of `A`, `T`, `G`, `C`, `U` characters.
- `createDuplex`: if `true`, also creates the complementary strand to form a double helix.
- `isRNA`: if `true`, uses RNA nucleotides (sugar/backbone geometry differs).

The new strand is placed 20 units in front of the camera (or at the origin if the scene is empty). Returns the array of all created elements.

```javascript
// 20-bp DNA duplex
edit.createStrand('ATCGATCGATCGATCGATCG', true);

// 12-bp RNA duplex
edit.createStrand('AUGCAUGCAUGC', true, true);

// single-stranded 10-mer DNA
edit.createStrand('AAATTTTGGG');
```

#### `edit.extendStrand(end: BasicElement, sequence: string): BasicElement[]`
Extends a single strand from the given terminal element. Returns new elements.
```javascript
edit.extendStrand(api.getElements([5])[0], 'GCGCGC');
```

#### `edit.extendDuplex(end: Nucleotide, sequence: string): BasicElement[]`
Extends both strands of a duplex. `end` must be a terminal nucleotide of the duplex.
```javascript
edit.extendDuplex(api.getElements([0])[0], 'AAAA');
```

#### `edit.deleteElements(victims: BasicElement[]): void`
Permanently deletes elements and their paired partners. Undoable.
```javascript
edit.deleteElements(api.getElements([10, 11, 12]));
edit.deleteElements([...selectedBases]);
```

#### `edit.nick(element: BasicElement): void`
Cuts the phosphodiester bond on the 5' side of `element`, splitting the strand in two.
```javascript
edit.nick(api.getElements([20])[0]);
```

#### `edit.ligate(a: BasicElement, b: BasicElement): void`
Joins the 3' end of `a` to the 5' end of `b`, forming a continuous strand.
```javascript
edit.ligate(api.getElements([3])[0], api.getElements([7])[0]);
```

#### `edit.skip(elems: BasicElement[]): void`
Deletes the given elements and automatically ligates their 5' and 3' neighbours so no strand break is introduced.
```javascript
edit.skip(api.getElements([5]));
```

#### `edit.insert(e: BasicElement, sequence: string): BasicElement[]`
Inserts new bases **after** element `e` in the strand.
```javascript
edit.insert(api.getElements([4])[0], 'TTTT');
```

#### `edit.getSequence(elems: Set<BasicElement>): string`
Returns the base sequence of a set of elements as a string.
```javascript
var seq = edit.getSequence(selectedBases);
notify('Sequence: ' + seq);
```

#### `edit.setSequence(elems: Set<BasicElement>, sequence: string, setComplementaryBases?: boolean): void`
Mutates the bases of the elements to match `sequence`. If `setComplementaryBases` is `true` and the elements are paired, the partners are also updated.
```javascript
edit.setSequence(selectedBases, 'ATCGATCG', true);
```

#### `edit.createBP(elem: Nucleotide, undoable?: boolean): Nucleotide`
Creates a complementary base-pair partner for an unpaired nucleotide. Returns the new nucleotide.
```javascript
var partner = edit.createBP(api.getElements([3])[0]);
```

#### `edit.interconnectDuplex3p(strand1: Strand, strand2: Strand, patchSeq?: string): void`
Bridges the 3' ends of two strands with a short duplex. Default patch sequence is `'GGGGGGGGG'`.
```javascript
edit.interconnectDuplex3p(
  api.getElements([0])[0].strand,
  api.getElements([50])[0].strand
);
```

#### `edit.interconnectDuplex5p(strand1: Strand, strand2: Strand, patchSeq?: string): void`
Same as above but bridges the 5' ends.

#### `edit.addElements(copies: InstanceCopy[]): BasicElement[]`
Pastes elements from saved instance copy data at their original positions.

#### `edit.addElementsAt(copies: InstanceCopy[], pos?: THREE.Vector3): BasicElement[]`
Pastes elements from instance copies at a specified position.

#### `edit.move_to(target: BasicElement, toDisplace: BasicElement[]): void`
Displaces a list of elements so that the first element lands on `target`'s position.
```javascript
edit.move_to(api.getElements([0])[0], api.getElements([5, 6, 7]));
```

---

### 7.4 Global Transform Functions

Defined in `ts/editing/translation.ts`. These are **not namespaced** — call them directly.

#### `translateElements(elements: Set<BasicElement>, v: THREE.Vector3): void`
Moves all elements in the set by the displacement vector `v`. This is the **only correct way** to move elements — `system.position` does not exist.

**Pattern — move system to absolute position (x, y, z):**
```javascript
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
translateElements(new Set(monomers), new THREE.Vector3(20, 20, 20).sub(com));
render();
```

#### `rotateElements(elements: Set<BasicElement>, axis: THREE.Vector3, angle: number, about: THREE.Vector3): void`
Rotates elements around `axis` by `angle` radians, pivoting around point `about`.

**Pattern — rotate system by 45° around its own Z-axis:**
```javascript
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
rotateElements(new Set(monomers), new THREE.Vector3(0, 0, 1), Math.PI/4, com);
render();
```

#### `rotateElementsByQuaternion(elements: Set<BasicElement>, q: THREE.Quaternion, about?: THREE.Vector3, updateScene?: boolean): void`
Rotates elements by a quaternion. `about` defaults to the origin.
```javascript
var q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI/2);
rotateElementsByQuaternion(new Set(systems[0].getMonomers()), q);
render();
```

---

### 7.5 System and Element Methods

#### `System` methods
```
system.getMonomers()         → BasicElement[]   every nucleotide in the system
system.strands               : Strand[]         all strands in the system
system.callAllUpdates()      → void             refresh typed instance arrays
system.select()              → void             select all monomers
system.deselect()            → void             deselect all monomers
```

#### `Strand` methods
```
strand.getMonomers()         → BasicElement[]   ordered 5'→3' nucleotide list
strand.end5                  : BasicElement     5' terminal element
strand.end3                  : BasicElement     3' terminal element
strand.isCircular()          → boolean          true if strand has no ends
```

#### `BasicElement` / `Nucleotide` properties and methods
```
element.id                   : number           global unique ID
element.sid                  : number           system-local ID
element.clusterId            : number           cluster assignment
element.strand               : Strand           parent strand
element.pair                 : Nucleotide|null  Watson-Crick paired partner
element.n3                   : BasicElement     3' neighbour (or null)
element.n5                   : BasicElement     5' neighbour (or null)
element.type                 : string           base letter A/T/G/C/U
element.getPos()             → THREE.Vector3    center-of-mass position
element.isPaired()           → boolean          true if element.pair != null
element.changeType(base)     → void             mutate to A/T/G/C/U
element.getComplementaryType()→ string          Watson-Crick complement
element.defaultColor()       → void             reset to strand/cluster colour
element.select()             → void             add to selection
element.deselect()           → void             remove from selection
```

---

### 7.6 Observable API

Defined in `ts/api/observable_api.ts`.

#### `new api.observable.CMS(elements: BasicElement[], size: number, color: number)`
Creates a sphere mesh that shows the center of mass of `elements`.
- `size`: sphere radius in oxDNA units
- `color`: hex colour number (e.g. `0xff0000` for red)
- `.calculate()`: updates the sphere position (call each animation frame)

```javascript
var cms = new api.observable.CMS(systems[0].getMonomers(), 0.5, 0xff0000);
scene.add(cms);
render();
```

#### `new api.observable.Track(particle: THREE.Mesh)`
Draws a line showing the displacement history of a `THREE.Mesh`.
- `.calculate()`: appends the mesh's current position to the line

#### `new api.observable.MeanOrientation(bases: BasicElement[], len?: number, color?: number)`
Renders an arrow showing the mean orientation (a1 vector) of the given bases.
- `.update()`: recalculates and reorients the arrow

#### `api.observable.wrap(fn: Function, fn_wrap: Function): Function`
Returns a new function that calls `fn_wrap` after `fn` every time it is invoked. Useful for attaching live observables to trajectory playback.

---

### 7.7 UI Helper Functions

Defined in `ts/UI/UI.ts`.

#### `notify(message: string, type?: string, keepOpen?: boolean, title?: string): void`
Shows a Metro UI toast notification.
- `type`: `'info'` (default) | `'success'` | `'warning'` | `'alert'`
```javascript
notify('Structure created!', 'success');
notify('Warning: unpaired bases detected.', 'warning');
```

#### `ask(title: string, content: string, onYes?: Function, onNo?: Function): void`
Opens a confirmation dialog. Calls `onYes` or `onNo` depending on user choice.
```javascript
ask('Delete?', 'Remove selected elements?',
    function(){ edit.deleteElements([...selectedBases]); render(); });
```

#### `colorElements(color?: THREE.Color, elems?: BasicElement[]): void`
Applies a custom colour to elements. If `elems` is omitted, colours `selectedBases`.
```javascript
colorElements(new THREE.Color(1, 0, 0));           // red on selection
colorElements(new THREE.Color(0, 1, 0), api.getElements([1,2,3])); // green on specific
```

#### `updateColoring(mode?: string): void`
Refreshes element colouring according to mode. Modes: `'Overlay'`, `'Strand'`, `'Custom'`, `'Position'`, `'Base'`, `'Index'`, `'Cluster'`.
```javascript
updateColoring('Base');   // colour by nucleotide type (A=green, T=red, etc.)
```

#### `resetCustomColoring(): void`
Resets all custom colours and restores Strand-mode colouring.

#### `view.toggleWindow(id: string, oncreate?: Function): void`
Opens or closes a named panel. Panel IDs (from index.html):
`'selectionWindow'`, `'distanceWindow'`, `'forcesWindow'`, `'fluctuationWindow'`, `'clusteringWindow'`.

#### `view.saveCanvasImage(scaleFactor?: number): void`
Downloads the current viewport as a PNG file.
```javascript
view.saveCanvasImage(2);  // 2× resolution screenshot
```

#### `view.longCalculation(calc: Function, message: string, callback?: Function): void`
Runs a heavy computation with a progress overlay. `callback` is called when done.

#### `view.scaleComponent(name: string, factor: number): void`
Scales a geometry component. Names: `'backbone'`, `'nucleoside'`, `'connector'`, `'bbconnector'`.
```javascript
view.scaleComponent('nucleoside', 2.0);  // double nucleoside size
view.scaleComponent('backbone', 0.5);    // half backbone size
```

#### `view.resetComponentScale(name: string): void`
Resets a geometry component to its default scale.

#### `resetScene(resetCamera?: boolean): void`
Clears all systems, elements, forces, and resets the UI. Pass `true` to also reset the camera.

#### `findBasepairs(minLen?: number): void`
Runs the base-pair detection algorithm across all loaded systems.

---

### 7.8 File I/O Globals

These are mostly used internally but can be called from generated code.

#### `TrajectoryReader` (class)
Manages trajectory playback. Instances are stored per-system.
```
reader.nextConfig()           advance to next frame
reader.previousConfig()       go back one frame
reader.retrieveByIdx(n)       jump to frame n
reader.playTrajectory()       start/stop animation
reader.currentFrame           current frame index (read)
reader.time                   simulation time of current frame (read)
```

---

## 8. Common Patterns & Code Templates

### Create a DNA duplex of N base pairs
```javascript
// Replace 'ATCGATCGATCG' with any N-char sequence
edit.createStrand('ATCGATCGATCG', true);
render();
```

### Create an RNA duplex
```javascript
edit.createStrand('AUGCAUGCAUGC', true, true);
render();
```

### Move all elements of system 0 to position (x, y, z)
```javascript
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
translateElements(new Set(monomers), new THREE.Vector3(X, Y, Z).sub(com));
render();
```

### Rotate system 0 by 90° around the Z-axis at its own centre
```javascript
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
rotateElements(new Set(monomers), new THREE.Vector3(0, 0, 1), Math.PI / 2, com);
render();
```

### Select and colour a strand red
```javascript
var strand = systems[0].strands[0];
api.selectElements(strand.getMonomers());
colorElements(new THREE.Color(1, 0, 0));
render();
```

### Delete selected elements
```javascript
edit.deleteElements([...selectedBases]);
render();
```

### Nick at element ID 20
```javascript
edit.nick(api.getElements([20])[0]);
render();
```

### Ligate two elements
```javascript
edit.ligate(api.getElements([3])[0], api.getElements([7])[0]);
render();
```

### Extend a duplex from its end
```javascript
edit.extendDuplex(api.getElements([0])[0], 'GCGCGC');
render();
```

### Get and display the sequence of selected bases
```javascript
var seq = edit.getSequence(selectedBases);
notify('Sequence: ' + seq, 'info', true);
```

### Mutate selected bases
```javascript
edit.setSequence(selectedBases, 'ATCGATCG', true);
render();
```

### Change colormap and show colorbar
```javascript
api.changeColormap('viridis');
api.setColorBounds(0, 50);
api.showColorbar();
render();
```

### Toggle visibility of system 0
```javascript
api.toggleAll(systems[0]);
render();
```

### Scale up nucleoside rendering
```javascript
view.scaleComponent('nucleoside', 1.5);
render();
```

### Place a center-of-mass marker
```javascript
var cms = new api.observable.CMS(systems[0].getMonomers(), 0.5, 0xff0000);
scene.add(cms);
render();
```

### Save a high-resolution screenshot
```javascript
view.saveCanvasImage(4);
```

### Reset the entire scene
```javascript
resetScene(true);
render();
```

---

## 9. UI Integration

### Ribbon Tab
A new **AI Chat** tab is added to the ribbon menu in `index.html`:
```html
<li ondblclick="view.sectionClicked()"><a href="#section-llm">AI Chat</a></li>
```
Clicking the tab reveals a ribbon section containing a single button that opens the chat panel.

### Chat Panel
A floating panel is injected into `index.html` below the `</nav>` tag:

| Element ID | Purpose |
|---|---|
| `llm-chat-panel` | Outer container (fixed, bottom-right, 380×500px) |
| `llm-chat-log` | Scrollable message history |
| `llm-chat-input` | Text input (Enter submits) |
| `llm-chat-send` | Submit button |

### Message CSS Classes
| Class | Colour | Used for |
|---|---|---|
| `llm-msg-user` | Blue-grey | User messages |
| `llm-msg-assistant` | Green-black | Full LLM response |
| `llm-msg-code` | Gold, monospace | Extracted JavaScript |
| `llm-msg-error` | Red | Errors |
| `llm-msg-system` | Grey | System notices and reasoning excerpts |

### Script Loading
`ts/llm_chat.js` is loaded as a plain `<script>` at the bottom of `<body>`, after all compiled viewer scripts, ensuring all globals exist before the chat is used.

---

## 10. Extending the System Prompt

To teach the model about new API functions:

1. Open `ts/llm_chat.js`
2. Find the `SYSTEM_PROMPT` constant
3. Add a new section following the existing format:

```javascript
════════════════════════════════════════
myModule.* — MY NEW FEATURE
════════════════════════════════════════
myModule.doThing(arg1: type, arg2: type)   → returnType
    One-line description of what it does.
    Example: myModule.doThing(systems[0], 42);
```

4. Add a worked example in the **COMMON PATTERNS** section at the bottom.

**Tips for good prompt entries:**
- Always include the full type signature — the model uses it to avoid type errors.
- Show at least one concrete example with realistic arguments.
- Explicitly call out any counterintuitive behaviour (e.g. "does not call render()").
- Cross-reference related functions.

---

## 11. Debugging Guide

### Chat panel not opening
- Open the browser console and check for JavaScript errors on page load.
- Verify `ts/llm_chat.js` is being served: navigate to `http://localhost:8080/ts/llm_chat.js`.
- Check that `llmChat` is defined: type `llmChat` in the console.

### API call fails (red error bubble)
- Check the browser console for the full error.
- Common causes: network block, expired API key, CORS issue.
- Test the API independently:
```bash
curl -X POST https://nano-gpt.com/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"zai-org/glm-5.1:thinking","messages":[{"role":"user","content":"say hi"}],"max_tokens":10}'
```

### Code executes but nothing visible in viewport
- The most common cause: the editing function ran but `render()` was not called. The post-execution `render()` in `sendMessage` should handle this, but if the model's code throws before returning, the explicit render won't fire. Check the console for execution errors.

### Wrong or hallucinated API call (e.g. `systems[0].position.set`)
- The model generated code using a non-existent API. This means the system prompt needs a clearer entry for that operation.
- Add the correct pattern to SYSTEM_PROMPT in `ts/llm_chat.js` and mark the wrong approach as explicitly forbidden: `"DO NOT use systems[0].position — this property does not exist."`.

### Execution error: `edit is not defined`
- `new Function(code)()` runs in global scope. If `edit` is not global, this will fail.
- Check that `dist/api/editing_api.js` is loaded **before** `ts/llm_chat.js` in `index.html`.
- Confirm `var edit;` exists at the top of `dist/api/editing_api.js`.

### Conversation going off-track
- Click 🗑 (the trash icon in the panel header) to clear the history and reset context.
- The system prompt is always prepended fresh, so only the conversation history accumulates drift.

---

## 12. Known Limitations

| Limitation | Notes |
|---|---|
| API key is hardcoded | The key is in `ts/llm_chat.js`. For production, load from an environment variable or a server-side proxy. |
| No streaming | The full response is awaited before display. Streaming would require handling `text/event-stream`. |
| No multi-step reasoning | The model gets one shot per message. Complex tasks that need intermediate state inspection are harder. |
| `new Function` security | Arbitrary JavaScript is executed. This is acceptable in a local tool but should not be exposed to untrusted users. |
| Context window | Very long conversations will accumulate history until the model's context limit. Clear history periodically. |
| Render timing | Some operations (e.g. `findBasepairs`) are asynchronous. The explicit `render()` fires immediately; async completions may need a subsequent render. |
| No undo integration | The code executes raw; it is undoable via Ctrl+Z (which uses `editHistory`) but not auto-detected by the chat. |

---

## 13. LLM Branch Background

The `LLM` branch (merged into `master`) added the following **training infrastructure** — not a chat interface, but the data used to understand the viewer API:

### `LLM/alpaca_dataset.jsonl`
10 809 instruction–output pairs in Alpaca format:
```json
{"instruction": "Create an RNA duplex with sequence AATT", "input": "", "output": "edit.createStrand('AATT', true, true)"}
```
Used to fine-tune a local model on oxView API calls.

### `LLM/generate_dataset.py`
Generates the dataset programmatically using templates. Each template defines:
- `intent`: semantic category
- `instruction`: natural-language template with `{placeholders}`
- `code_template`: JavaScript with matching placeholders
- `params`: list of parameter generators (random IDs, sequences, colours, etc.)

### `LLM/filter_dataset.py`
Deduplicates entries, removes near-duplicates, and enforces coverage across different intent categories.

### `LLM/select_verification_commands.py`
Selects a representative subset of commands for manual verification. Outputs `verification_commands.json`.

### `LLM/extract_ts_info.py`
Parses all TypeScript source files and extracts function signatures, parameter names, and JSDoc comments. Output is used to augment dataset generation with accurate type information.

### `LLM/notWorking.json`
Records commands that were generated but failed during verification. Used to avoid generating broken patterns in future dataset iterations.

---

*Last updated: 2026-05-02. Maintained by Subhajit-Roy-Partho.*
