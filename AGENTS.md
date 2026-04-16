# AGENTS.md

This file is the repo-level handoff document for humans and AI agents working in `oxdna-viewer`.

Read this before making changes. The project has a lot of implicit runtime coupling, global state, and generated artifacts. Most breakages here come from editing the right code in the wrong place, or editing the right source file without updating the manual build/load wiring.

## What This Project Is

`oxdna-viewer` is a browser/Electron visualization and editing tool for oxDNA, RNA, protein, and related coarse-grained structures.

The main application is:

- A global-script browser app loaded from `index.html`
- Backed by TypeScript source in `ts/`
- Compiled into committed JavaScript in `dist/`
- Rendered with Three.js instancing
- Wired together manually through script order rather than ES module imports

There is also a separate subproject:

- `langGraph/` is a standalone Node/TypeScript CLI helper that drives a live oxView page over Chrome DevTools Protocol

## First Principles

These are the most important truths about the repo.

1. `ts/` is the main source of truth for the app.
2. `dist/` is generated output, but it is committed and used at runtime.
3. `index.html` manually loads scripts in a specific order. Script order matters.
4. `tsconfig.json` uses an explicit `"files"` list, not broad includes. New TS files do not build unless added there.
5. Some runtime content is split across code and HTML fragments:
   - window content lives in `windows/*.html` and `windows/*.json`
   - the logic behind those windows usually lives in `ts/UI/UI.ts` or other globals
6. Electron startup is thin. Most real startup happens in the browser page.
7. The repo contains legacy and stale generated files. Do not assume every file in `dist/` is still source-backed.

## Source Of Truth Vs Generated Content

Edit these directly:

- Root source/docs/config: `package.json`, `tsconfig.json`, `index.html`, `index.js`, `renderer.js`, `README.md`, `file-format.md`
- App source: `ts/`
- Window definitions: `windows/`
- Build scripts: `scripts/`, `script/`
- Tests: `test/`
- Examples and tutorials: `examples/`
- LangGraph source: `langGraph/src`, `langGraph/test`, `langGraph/package.json`, `langGraph/tsconfig.json`, `langGraph/README.md`
- LLM/offline tooling: `LLM/`
- Main authored styling: `css/style.css`

Usually do not edit these directly:

- `dist/`
- `.gh-pages-dist/`
- `langGraph/dist/`
- `node_modules/`
- vendored library files in `ts/lib/`, `ts/controls/`, `ts/geometries/`, `css/metro*.css`, `mif/`

Treat as generated or derivative unless you are intentionally refreshing them:

- `favicons/`
- `.gh-pages-dist/`
- compatibility bundles in `dist/vendor/`

## Quick Start

Main app, browser workflow:

```bash
npm install
npm run build
python -m http.server 8000
```

Then open `http://localhost:8000`.

Main app, Electron workflow:

```bash
npm install
npm run build
npm start
```

Live rebuild workflow:

```bash
npm run load
```

Notes:

- `npm run load` is an older POSIX-style workflow using `tsc -w & reload -b`.
- There is no real root lint step.
- Root automated testing is browser-based through `test.html`, not a normal `npm test` script.

LangGraph helper:

```bash
cd langGraph
cp .env.example .env
npm install
npm run build
npm test
npm run chat
```

LangGraph notes:

- it requires a live oxView page that is already open in Chrome/Electron with CDP reachable
- minimum env is `OPENAI_API_KEY`, `OPENAI_MODEL`, and usually `OXVIEW_CDP_URL=http://127.0.0.1:9222`
- `OPENAI_BASE_URL` is optional and supports OpenAI-compatible providers

## Boot Sequence

### Browser / Electron startup

1. Electron, if used, starts from `index.js`.
2. `index.js` creates a `BrowserWindow`, enables Node integration, disables context isolation, stores argv on `global.sharedObject.argv`, and loads `index.html`.
3. `index.html` loads UI markup and then a long ordered script chain.
4. `dist/vendor/three-compat.js` publishes a global `THREE` and patches old APIs expected by the legacy code.
5. Scene/bootstrap files load first, then file handling, then UI/edit/model/api code, then `main.js`, then `renderer.js`.
6. `renderer.js` adds Electron-specific path-argument behavior or browser-specific video capture behavior.

### The practical dependency chain

The runtime is not a normal module graph. Think in terms of:

- `index.html` decides load order
- globals created by earlier files are used by later files
- `tsconfig.json` decides which TS files build into `dist/`

If you add a new file and only do one of these two things, the app will still break:

- add it to `tsconfig.json`
- load it from `index.html`

You usually need both.

## High-Level Architecture

### Rendering model

The viewer renders most scene objects through Three.js instancing:

- `System` owns large typed arrays for positions, rotations, scales, colors, visibility, and labels
- `BasicElement` and subclasses are lightweight handles into one row of those arrays
- after mutating data, code calls `System.fillVec(...)`, `System.callUpdates(...)`, and `render()`

### Domain model

The important runtime objects are:

- `System`: a loaded structure and its instance buffers
- `Strand`: topology ordering and traversal
- `BasicElement`: abstract monomer/particle
- `DNA`, `RNA`, `AminoAcid`, `GenericSphere`, `PatchyParticle`: concrete element types

### Interaction model

The UI is split across:

- DOM in `index.html`
- window fragments in `windows/`
- handlers and state in `ts/UI/UI.ts`
- selection logic in `ts/UI/base_selector.ts`
- keyboard shortcuts in `ts/UI/keybindings.ts`

### Editing model

Topology changes happen through:

- `ts/api/editing_api.ts` for core edit primitives
- `ts/editing/editing.ts` for UI-facing wrappers
- `ts/editing/doUndo.ts` for revertable edits and undo/redo

Edits often create temporary visual backing systems:

- `tmpSystems` contains transient systems created during editing
- `dummySys` on an element tells rendering code to use the temporary buffers instead of the original owning system

### File I/O model

The file pipeline is:

1. file discovery and dispatch in `ts/file_handling/file_getters.ts` and `ts/file_handling/file_handling.ts`
2. system parsers in `ts/file_handling/system_readers.ts`
3. auxiliary data readers in `ts/file_handling/aux_readers.ts`
4. trajectory indexing in `ts/file_handling/io.ts` plus worker files
5. export logic in `ts/file_handling/output_file.ts`, `video.ts`, `stl_exporter.ts`, `GLTFExporter.ts`

### Scriptability model

The app exposes global APIs:

- `api.*` for scene/query actions
- `edit.*` for topology edits
- `api.observable.*` for scene observables

These are used by:

- browser console scripting
- plugin scripts
- dropped `.js` scripts
- `langGraph` page helpers

## Core Runtime Concepts

### Global registries

`ts/main.ts` defines the major global runtime containers:

- `elements`: global id -> `BasicElement`
- `systems`: loaded systems in the scene
- `selectedBases`: current selection set
- `tmpSystems`: temporary backing systems created during edits
- `editHistory`: undo/redo stack
- `forceHandler`: active force registry
- `networks`: ANM/network objects
- `box`: current simulation box

### IDs

There are two important ids:

- global element id: stable id used by `elements`
- `sid`: the element's index within a `System` instance buffer

When debugging rendering bugs, always ask whether code means:

- global object identity
- per-system buffer index

### `System` vs `tmpSystems` vs `dummySys`

This is one of the hardest concepts in the repo.

- A normal loaded element belongs to a real `System`
- During editing, new or moved elements can be visualized through temporary systems in `tmpSystems`
- `dummySys` overrides where instance data is read from

This is why edits can appear correct topologically but render incorrectly if the wrong backing system gets updated.

### Selection

Selection is not just a DOM state. It drives rendering:

- `selectedBases` is the source of truth
- selecting an element changes scale and color state
- different selection modes can mean monomer, strand, system, cluster, or box-based behavior

### Undo / redo

Undo is explicit and object-based:

- `EditHistory` stores `RevertableEdit` objects
- concrete edit classes snapshot just enough state to undo and redo
- many UI actions are thin wrappers around these revertable edits

## Detailed File Map

## Root Files

- `package.json`
  - root build and packaging entrypoint
  - owns `build:three`, `build:app`, `build`, `start`, `load`, `prepare:gh-pages`, `save-canvas-image`
  - also contains Electron Forge packaging config
- `tsconfig.json`
  - root TypeScript compiler config
  - explicit file allowlist for the compiled browser app
  - if your new TS file is missing from here, it will not build
- `index.html`
  - main browser shell and all UI markup
  - loads `dist/` output and some vendored libs
  - contains manual script ordering, some inline helpers, and iframe-specific UI hiding
  - currently contains duplicate script blocks in the file-handling area
- `index.js`
  - Electron main process
  - creates the window, loads `index.html`, exposes argv, optionally opens DevTools with `--js`
- `renderer.js`
  - Electron/browser bridge
  - Electron path:
    - loads persisted settings via `electron-settings`
    - loads files passed on the command line
  - browser path:
    - enables the video button
    - injects `CCapture.all.min.js`
- `README.md`
  - main end-user and developer documentation
  - covers supported formats, console APIs, local development, and examples
- `file-format.md`
  - spec for the `.oxview` JSON format
- `LICENSE`
  - GPL-3.0-or-later
- `test.html`
  - browser test harness that loads the app into an iframe and runs Mocha/Chai tests from `test/test.edit.js`

## Build Scripts

### `scripts/`

- `build-three-compat.mjs`
  - bundles modern npm `three` into browser and worker compatibility shims
- `three-browser-entry.mjs`
  - compatibility entry for the main browser app
  - exports a global `THREE`
  - patches older method/property names expected by legacy code
  - wires in `TrackballControls`, `TransformControls`, `ConvexGeometry`, `Lut`, `GLTFExporter`, `STLExporter`, `VRButton`
- `three-worker-entry.mjs`
  - smaller compatibility entry for workers
  - only patches the subset of Three APIs needed in worker code
- `prepare-gh-pages.mjs`
  - copies a deployable subset of the repo into `.gh-pages-dist/`
  - this is the source of the GitHub Pages publish step

### `script/`

- `save-canvas-image.js`
  - CLI utility that launches Electron headlessly, waits for oxView to finish loading, and saves a rendered image
  - useful for automated screenshots and fixtures

## Main App Source: `ts/`

### `ts/main.ts`

This is the shared runtime state hub.

Responsibilities:

- defines the global registries and mutable shared state
- resets the scene and global app state
- kicks off URL parameter loading
- wires drag/drop and postMessage integration
- exposes broad app-level helpers like base-pair detection

Read this early if you need to understand what globals exist.

### `ts/api/`

- `scene_api.ts`
  - the scriptable scene/query API
  - owns many browser console commands documented in the README
  - includes shared API error recording and wrapping
  - this is a major integration surface for scripts and LangGraph
- `editing_api.ts`
  - the real topology editing engine
  - includes create, delete, nick, ligate, extend, insert, duplex operations, sequence mutation, base-pair editing, discretization, etc.
  - if you want to add a new edit capability, this is usually where it belongs
- `observable_api.ts`
  - scene observables like center-of-mass markers, tracks, and orientation arrows
  - mostly visualization helpers layered on top of the existing scene
- `plugin_api.ts`
  - tiny plugin system stored in `localStorage`
  - executes plugin code with `eval`
  - useful but security-sensitive

### `ts/scene/`

- `scene_setup.ts`
  - scene bootstrap
  - camera creation and camera switching
  - renderer and canvas setup
  - fog, axes, lighting, resize handling
  - trackball and transform control setup
  - render loop
- `instancing.ts`
  - patches materials for instanced attributes
  - creates picking materials and GPU picking helpers
  - central to hover/selection
- `mesh_setup.ts`
  - shared instanced geometry and material setup
  - backbone/nucleoside/connector meshes and color palettes
- `PBC_switchbox.ts`
  - periodic-boundary centering/inboxing logic
  - important for bringing imported structures into view correctly

### `ts/model/`

- `system.ts`
  - `System` class
  - owns typed arrays used for instanced rendering
  - also contains `PatchySystem`
- `basicElement.ts`
  - abstract monomer base class
  - shared selection, color, buffer access, visibility, serialization logic
- `strand.ts`
  - abstract strand traversal and strand subclasses
  - concrete strand families include nucleic acid, peptide, and generic
- `nucleotide.ts`
  - nucleotide-specific geometry and orientation logic
  - pairing helpers and nucleotide coloring
- `DNA.ts`
  - DNA-specific extension geometry and backbone placement
- `RNA.ts`
  - RNA-specific extension geometry and backbone placement
- `aminoAcid.ts`
  - protein element visualization path
  - editing support is thinner than nucleotide support
- `genericSphere.ts`
  - generic sphere particles and patchy particle support
- `force.ts`
  - force hierarchy, force scene objects, serialization, and `ForceHandler`
  - large, important, and harder than average to modify safely
- `network.ts`
  - ANM/network representation, edges, fitting helpers, and visualization
- `anm.ts`
  - mostly legacy/commented ANM code
- `anm_worker.ts`
  - worker-side math for network/ANM calculations
- `svd.ts`
  - standalone SVD implementation
- `leastSquares.ts`
  - least-squares helpers used in fitting/math paths
- `leastSquares 2.ts`
  - duplicate of `leastSquares.ts`
  - likely vestigial and worth treating cautiously

### `ts/editing/`

- `editing.ts`
  - UI-facing wrappers for copy/cut/paste/create/extend/delete flows
  - bridges user actions to the lower-level edit API and undo system
  - note: this file exists in source, but current `tsconfig.json` does not compile it; `index.html` still loads the old generated `dist/editing/editing.js`
- `doUndo.ts`
  - undo/redo stack and concrete `Revertable*` edit classes
  - very important when adding a new edit action that should undo cleanly
- `translation.ts`
  - translation and rotation math
  - backbone connector repair
  - updates to related forces and networks
- `selections.ts`
  - saved named selections and their UI rendering
- `distance.ts`
  - distance measurements, line overlays, and related UI
- `clustering.ts`
  - cluster assignment helpers, including DBSCAN-like logic
- `dijkstra.ts`
  - shortest-path selection along topology and optional pairing edges
- `rigid-body_simulation.ts`
  - experimental rigid-cluster dynamics

### `ts/UI/`

- `UI.ts`
  - main `View` controller and most window/toggle logic
  - scene settings, exports, progress dialogs, many button handlers
  - also owns the fluctuation graph UI
- `base_selector.ts`
  - hover and click picking
  - selection modes
  - box selection and related behavior
  - updates selection side panels
- `keybindings.ts`
  - keyboard shortcuts for camera, transforms, editing, and trajectory controls

### `ts/file_handling/`

- `file_handling.ts`
  - central dispatcher for dropped/opened files
  - classifies files into system, auxiliary, or script inputs
  - handles zstd-compressed observable outputs
  - assembles systems into instanced scene objects
- `file_getters.ts`
  - drag/drop event handling
  - loading from URL query params
  - message-based embedding hooks
  - RCSB fetch helpers
  - Electron path-argument loading
- `system_readers.ts`
  - main parsers for system-creating file formats:
    - oxDNA topology/config
    - oxView JSON
    - patchy systems
    - PDB/mmCIF handoff paths
    - UNF
    - XYZ/MGL support
- `aux_readers.ts`
  - parsers for auxiliary scene data:
    - trajectories
    - overlays
    - forces
    - selection files
    - camera files
    - CSV
    - parameter files
    - hydrogen bond files
    - dot-bracket files
- `io.ts`
  - chunked trajectory indexing and retrieval
  - uses a worker for large trajectory indexing
- `read_worker.ts`
  - worker used by trajectory indexing
- `output_file.ts`
  - writes simulation files and other exports
  - important when changing serialization behavior
- `video.ts`
  - canvas/video export logic
- `GLTFExporter.ts`
  - GLTF export integration
- `stl_exporter.ts`
  - STL export integration
- `pdb_lib.ts`
  - PDB parsing helpers and data structures
- `pdb_worker.ts`
  - worker for PDB parsing
- `mmcif_lib.ts`
  - mmCIF parsing helpers
- `mmcif_worker.ts`
  - worker for mmCIF parsing
- `xyz_reader.ts`
  - XYZ file reader
- `UNF_reader.ts`
  - UNF reader source exists
  - note: current `tsconfig.json` does not compile it, but `index.html` still loads `dist/file_handling/UNF_reader.js`
- `order_parameter_selector.ts`
  - order parameter / trajectory plotting window logic
- `plateDB.ts`
  - plate database import/storage helpers
- `script_reader.ts`
  - executes dropped `.js` files with `eval`
  - security-sensitive by design
- `taco.ts`
  - UI integration for importing via TacoxDNA
- `tacoxdna_worker.ts`
  - worker that performs the conversion logic

### `ts/ox_serve/`

- `live_relax.ts`
  - WebSocket bridge to oxServe
  - sends simulation payloads and streams updates back into the viewer
- `relax_scenarios.ts`
  - canned MC and MD_GPU parameter sets

### `ts/controls/`

Mostly vendored or compatibility-focused. Edit only intentionally.

- `TrackballControls.js`
  - camera controls with local custom helpers
- `TransformControls.js`
  - transform gizmo with oxView-specific expectations
- `SceneUtils.js`
  - legacy Three helper shim
- `three-trackballcontrols.d.ts`, `three-transformcontrols.d.ts`
  - declaration shims

### `ts/geometries/`

Mostly vendored geometry helpers.

- `ConvexGeometry.js`
- `ConvexHull.js`
- `three-convexgeometry.d.ts`

### `ts/lib/`

Committed third-party libraries and legacy assets.

Highlights:

- `three.js` and `three-core.d.ts`
- `tacoxdna.js`
- `metro.min.js`
- `chart.min.js`
- `chartjs-plugin-annotation.min.js`
- `CCapture.all.min.js`
- `Lut.js`
- `VRButton.js`
- `justcontext.js`

Do not casually edit these.

### `ts/typescript_definitions/`

Declaration files to keep the old global-script codebase type-checkable in editors.

These are not the runtime. They are editor/compiler support.

## Window Fragments: `windows/`

These files are live UI source.

Each window is split into:

- `*.json`: Metro window placement/config
- `*.html`: DOM content

Pairs:

- `baseInfoWindow`
- `clusteringWindow`
- `colorPaletteWindow`
- `distanceWindow`
- `fluctuationWindow`
- `forcesWindow`
- `hyperSelectWindow`
- `oxserveWindow`
- `plateDBWindow`
- `selectionWindow`
- `systemHierarchyWindow`
- `videoCreationWindow`

When adding a new window:

1. add both HTML and JSON
2. wire open/load behavior in `ts/UI/UI.ts`
3. ensure any called global functions exist before window content uses them

## Tests

- `test/test.edit.js`
  - browser-side Mocha/Chai tests
  - covers editing behavior and some runtime compatibility checks

Important limitation:

- root tests are not part of CI in a strong way
- many runtime paths remain manually verified

## Examples: `examples/`

These are tutorial fixtures, sample data, and scripts. They are not dead content; they teach the intended workflows.

- `examples/README.md`
  - table of contents for example families
- `1-cadnano_import_example-linear_actuator/`
  - caDNAno import + positioning example
- `2-free-form_design_example-tetrahedron/`
  - manual design and ligation walkthrough
- `4-external_simulation-tetrahedron/`
  - external oxDNA simulation workflow
- `4-scripting_example-python/`
  - analysis-side scripting example
- `5-scripting_example-death_star/`
  - browser console scripting example with scene additions
- `5-scripting_example-nanocrystal/`
  - large scripting-based assembly example
- `7-protein_example-tetrahedron/`
  - DNA-protein ANM / hybrid workflow
- `icosahedron/`, `square/`, `triangle/`
  - rigid-body relaxation examples
- `scripting_tutorial/`
  - intro to oxView data structures and scripting
- `demo_plugin/`
  - simple plugin examples

Most example folders include:

- README instructions
- structure files
- simulation inputs
- images
- sometimes JS or Python scripts

Update them when changing user-facing workflows.

## LLM Folder: `LLM/`

This is offline tooling and dataset material, not runtime-critical app code.

- `generate_dataset.py`
  - dataset generation script
- `select_verification_commands.py`
  - extracts one representative command per intent
- `filter_dataset.py`
  - dataset cleaning/filtering
  - be careful: default behavior can overwrite inputs
- `extract_ts_info.py`
  - source analysis helper
- `alpaca_dataset.jsonl`
  - large instruction/output dataset
- `verification_commands.json`
  - smaller verification subset
- `notWorking.json`
  - failed/problematic cases

## Styling And Assets

### `css/`

- `style.css`
  - main authored stylesheet
- `style_old.css`
  - legacy stylesheet, appears unused
- `metro.min.css`, `metro-colors.min.css`, `metro-icons.min.css`
  - vendored Metro UI assets
- `justcontext.css`
  - vendored/unreferenced context-menu styling

### `img/`

- `img/ico/*`
  - action icons used in the UI
- `editing.gif`, `icosahedron.png`
  - docs/tutorial visuals

### `favicons/`

Generated favicon pack and manifest. Usually refresh as a set.

### `mif/`

Metro icon font payload. Treat as vendored.

## Generated Output

### `dist/`

Runtime JavaScript used by the app. Generated from source plus compatibility bundling.

Do not treat it as canonical source.

Known caveat:

- some files in `dist/` appear stale or legacy and no longer map cleanly to the current TypeScript config

### `.gh-pages-dist/`

Publishable static site snapshot generated by `npm run prepare:gh-pages`.

Never edit this directly.

## LangGraph Subproject

`langGraph/` is separate from the root app build. It is a standalone Node/TypeScript helper package that drives a live oxView page from outside the browser process.

### Runtime model

LangGraph is not loaded by `index.html`.

It works like this:

1. you start oxView normally in a browser or Electron window
2. that window must be reachable over Chrome DevTools Protocol
3. `langGraph/src/runtime/cdpSession.ts` discovers the page target and injects `langGraph/src/tools/pageHelpers.ts`
4. the CLI in `langGraph/src/cli/chat.ts` sends user requests into the LangGraph state machine in `langGraph/src/graph/buildGraph.ts`
5. the model facade in `langGraph/src/runtime/modelFacade.ts` classifies the request, plans typed tool calls from `langGraph/src/tools/catalog.ts`, and the graph executes those helpers against the live page

The main implication:

- if CDP cannot see the right oxView tab, LangGraph cannot do anything
- if a browser helper depends on a missing global in oxView, the tool fails inside the page, not inside Node

### Current capability surface

The tool catalog is now broad enough to cover most day-to-day GUI work through typed tools.

Current tool families:

- scene/query:
  - scene summary/state
  - system hierarchy
  - API error inspection
  - element lookup/info
  - distances, centers of mass, strand tracing, sequences
  - force listing
  - network listing
  - named-selection listing
  - graph-dataset listing
- selection:
  - explicit element selection
  - clear selection
  - select strand ends
  - select by PDB residues
  - explicit selection mode changes
  - save/apply/delete/rename named selections
- view/display:
  - custom coloring
  - coloring mode and overlay controls
  - focus helpers
  - element/strand/component visibility
  - component scale
  - base color mode
  - render preset
  - projection/background/axes/box/fog/3-prime markers
  - compatibility toggles like camera/base-color/visibility aliases
- transforms:
  - translate
  - rotate
  - move-to
- topology/editing:
  - create strand / duplex
  - extend strand / duplex
  - insert
  - skip
  - delete
  - nick
  - ligate
  - set sequence
  - create base pair
  - interconnect duplex
- forces:
  - create mutual traps
  - create pair traps from existing basepairs
  - create sphere force
  - import force text
  - export force text
  - remove forces
- networks/clustering:
  - create network
  - delete network
  - select network
  - explicit network visibility
  - copy network with deep-copied edge state
  - fill network edges for `ANM`, `MWCENM`, `ANMT`
  - clear clusters
  - run DBSCAN
  - assign explicit elements to a new cluster
- exports:
  - oxDNA bundle
  - oxView JSON
  - sequences CSV
  - selected-base text
  - index text
  - network JSON
  - fluctuation JSON
  - UNF JSON
  - camera state
- clipboard/history:
  - copy
  - cut
  - paste
  - undo
  - redo

### Important files

- `langGraph/package.json`
  - package-local scripts: `build`, `chat`, `test`
- `langGraph/tsconfig.json`
  - NodeNext config for the helper package
- `langGraph/README.md`
  - package-level architecture and usage doc
- `langGraph/src/cli/chat.ts`
  - interactive terminal prompt
  - constructs the model facade and graph
  - passes optional `OPENAI_BASE_URL` through to the model layer
- `langGraph/src/config/env.ts`
  - env loading and zod validation
  - supports `OPENAI_API_KEY`, `OPENAI_MODEL`, optional `OPENAI_BASE_URL`, and oxView/CDP settings
- `langGraph/src/runtime/cdpSession.ts`
  - CDP target discovery
  - helper injection
  - browser-context evaluation
- `langGraph/src/runtime/modelFacade.ts`
  - request classification heuristics
  - planner prompt
  - OpenAI/OpenAI-compatible API calls
  - tool-schema exposure to the planner
- `langGraph/src/graph/buildGraph.ts`
  - LangGraph state machine
  - risk-aware confirmation
  - `prepare_execution` step that clears stale oxView API errors before running tools
- `langGraph/src/tools/schemas.ts`
  - zod schemas used both for runtime validation and planner JSON schema generation
- `langGraph/src/tools/catalog.ts`
  - canonical LLM-facing tool list
  - tool metadata: `name`, `description`, `risk`, `category`, `schema`, generated JSON schema
- `langGraph/src/tools/pageHelpers.ts`
  - browser-side helpers injected into oxView
  - this is the real integration layer into the global-script app
  - if a tool exists in the catalog, its behavior is ultimately defined here
- `langGraph/src/types.ts`
  - shared types/interfaces
  - includes the richer `AvailableToolMetadata` shape used by planning
- `langGraph/src/index.ts`
  - barrel exports
- `langGraph/test/catalog.test.ts`
  - tool catalog and JSON schema coverage
- `langGraph/test/graph.test.ts`
  - graph-level behavior and confirmation coverage
- `langGraph/test/schemas.test.ts`
  - schema validation coverage

### How to run it locally

Typical local workflow:

1. run oxView from this repo or open the hosted app
2. launch the browser with remote debugging enabled, usually on port `9222`
3. verify the oxView page is reachable at `http://127.0.0.1:9222/json/list`
4. in `langGraph/.env`, set:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - optional `OPENAI_BASE_URL`
   - `OXVIEW_CDP_URL`
   - optional execution knobs like `OXVIEW_EXECUTION_MODE` and `OXVIEW_MAX_REPAIR_ATTEMPTS`
5. run `npm run build && npm test && npm run chat` inside `langGraph/`

tmux is a good fit here because the oxView session and the LangGraph CLI session are independent long-running processes.

### Safety model and known caveats

Important safety behavior:

- tool planning uses real JSON schema, not empty `{}` parameter placeholders
- confirmation is based on planned tool risk, not only the wording of the user message
- destructive tool plans move the graph to `needs_confirmation`
- stale oxView API errors are cleared before execution

Current caveats that matter during development:

- raw-JS generation still exists as preview/fallback behavior, but typed tools are the primary path
- confirmation still reruns the graph from scratch after approval
- the helper layer depends on oxView globals such as `view`, `api`, `edit`, `systems`, `elements`, `forceHandler`, `networks`, `selectionListHandler`
- some GUI features still have legacy semantics underneath the helper wrappers

Specific quirks worth remembering:

- force add/remove flows are not backed by `editHistory`
- force removal in the base app is incomplete for mixed force types, so LangGraph now rebuilds force scene objects itself after changes
- network deletion and clustering operations are not undo-backed in the base app
- the GUI network copy path aliases edge data by reference; the LangGraph helper intentionally deep-copies it instead
- `export_network_json` matches the GUI export and only returns network masses plus coordinates, not explicit edges
- `export_fluctuation_json` mutates the flux view type/units because `graphData.toJson()` in the main app does that today
- UNF export still uses the main app’s export builder and therefore inherits its current metadata assumptions from the UI/global state

### Add a new LangGraph tool

Do not stop at only adding a helper.

The real add-tool path is:

1. add or update schema in `langGraph/src/tools/schemas.ts`
2. implement the browser helper in `langGraph/src/tools/pageHelpers.ts`
3. register the tool in `langGraph/src/tools/catalog.ts`
4. choose the correct `risk` and `category`
5. if the tool changes the confirmation or classification story, update `langGraph/src/runtime/modelFacade.ts`
6. if execution flow or pre/post checks need changes, update `langGraph/src/graph/buildGraph.ts`
7. add or update tests in `langGraph/test/`
8. run `npm run build` and `npm test` in `langGraph/`

Risk guidance:

- use `read` for non-mutating inspection/export helpers
- use `mutating` for reversible or low-stakes scene/state changes
- use `destructive` for topology edits, deletes, replace-all operations, or anything with no trustworthy undo path

## Known Footguns And Technical Debt

These are the main things that can waste hours.

### 1. Manual compile/load wiring

If you add a file:

- add it to `tsconfig.json`
- add the resulting script to `index.html`

If you forget either, you get confusing runtime failures.

### 2. Stale `dist/` files

Current observed drift:

- `ts/editing/editing.ts` exists, but root `tsconfig.json` does not compile it
- `ts/file_handling/UNF_reader.ts` exists, but root `tsconfig.json` does not compile it
- `index.html` still loads `dist/editing/editing.js` and `dist/file_handling/UNF_reader.js`

That means a clean rebuild can diverge from the committed runtime state.

### 3. Duplicate script blocks in `index.html`

The file-handling area includes duplicated loads for:

- `file_handling.js`
- `system_readers.js`
- `aux_readers.js`
- `file_getters.js`
- `fzstd` setup

Be careful when reorganizing load order.

### 4. Global-state coupling

Many files silently rely on globals from earlier scripts:

- `scene`
- `camera`
- `renderer`
- `controls`
- `view`
- `elements`
- `systems`
- `selectedBases`
- `editHistory`
- `render`

### 5. `dummySys` / `tmpSystems`

Edits that look fine in topology but broken in rendering often come from updating the wrong backing system.

### 6. `eval`

These surfaces intentionally execute arbitrary code:

- plugin system in `ts/api/plugin_api.ts`
- dropped script support in `ts/file_handling/script_reader.ts`

Treat them as privileged behavior.

### 7. Legacy / experimental islands

These areas are valuable but harder to change safely:

- `ts/model/force.ts`
- `ts/model/network.ts`
- `ts/editing/rigid-body_simulation.ts`
- `ts/ox_serve/live_relax.ts`
- parts of protein/ANM code

## Common Change Recipes

### Add a new TypeScript file to the main app

1. create the file under `ts/`
2. add it to `tsconfig.json`
3. load its compiled output from `index.html` in the right order
4. run `npm run build`
5. verify the page still initializes

### Add a new parser or file format

Check these places:

- `ts/file_handling/file_handling.ts` for classification/dispatch
- `ts/file_handling/system_readers.ts` or `aux_readers.ts` for parsing
- `ts/file_handling/output_file.ts` if export support is needed
- `README.md` if the format is user-facing
- examples/tests if appropriate

### Add a new edit operation

Check these places:

- `ts/api/editing_api.ts` for the core edit
- `ts/editing/doUndo.ts` for undo/redo support
- `ts/editing/editing.ts` for UI-facing wrapper behavior
- `ts/UI/UI.ts` or keybindings if exposed in the UI
- rendering update calls on affected systems

### Add a new UI window

1. add `windows/<name>.html`
2. add `windows/<name>.json`
3. wire it in `ts/UI/UI.ts`
4. verify any referenced globals already exist at the time the window opens

### Add a new LangGraph tool

1. add schema in `langGraph/src/tools/schemas.ts`
2. implement browser helper in `langGraph/src/tools/pageHelpers.ts`
3. register tool in `langGraph/src/tools/catalog.ts`
4. update prompts or safety assumptions in `langGraph/src/runtime/modelFacade.ts` if needed
5. add tests in `langGraph/test/`

## What To Read First For Common Tasks

If you are new and need orientation:

- start with `README.md`
- then read `AGENTS.md`
- then inspect `ts/main.ts`, `ts/scene/scene_setup.ts`, `ts/file_handling/file_handling.ts`, `ts/model/system.ts`, `ts/api/scene_api.ts`, `ts/api/editing_api.ts`, `ts/UI/UI.ts`

If you are debugging selection:

- `ts/scene/instancing.ts`
- `ts/UI/base_selector.ts`
- `ts/api/scene_api.ts`

If you are debugging edits:

- `ts/api/editing_api.ts`
- `ts/editing/editing.ts`
- `ts/editing/doUndo.ts`
- `ts/editing/translation.ts`

If you are debugging file imports:

- `ts/file_handling/file_handling.ts`
- `ts/file_handling/file_getters.ts`
- `ts/file_handling/system_readers.ts`
- `ts/file_handling/aux_readers.ts`

If you are debugging rendering/state mismatch:

- `ts/model/system.ts`
- `ts/model/basicElement.ts`
- `ts/editing/translation.ts`
- `ts/file_handling/file_handling.ts`

If you are extending LangGraph:

- `langGraph/README.md`
- `langGraph/src/cli/chat.ts`
- `langGraph/src/runtime/cdpSession.ts`
- `langGraph/src/runtime/modelFacade.ts`
- `langGraph/src/graph/buildGraph.ts`
- `langGraph/src/tools/schemas.ts`
- `langGraph/src/tools/catalog.ts`
- `langGraph/src/tools/pageHelpers.ts`
- `langGraph/test/`

## Agent Checklist Before Finishing Work

Before considering a change complete:

1. confirm you edited source, not only generated output
2. confirm `tsconfig.json` and `index.html` are still correct if files were added or moved
3. rebuild the affected package
4. verify the impacted runtime path manually or with tests
5. check for stale/dist-only edits and clean them up intentionally if needed

## Short Handoff Summary

If an AI agent only remembers ten things, remember these:

1. Main app source is `ts/`, but runtime executes `dist/`.
2. `index.html` script order is part of the architecture.
3. `tsconfig.json` explicit file list is part of the architecture.
4. `System` owns render buffers; `BasicElement` is a handle into them.
5. `tmpSystems` and `dummySys` are the editing-rendering bridge.
6. `scene_api.ts` and `editing_api.ts` are the main scriptable surfaces.
7. `UI.ts` is the central UI controller.
8. `file_handling.ts` is the file ingestion hub.
9. `dist/` contains stale legacy artifacts; do not blindly trust it.
10. `langGraph/` is a separate package that drives oxView through globals over CDP.
