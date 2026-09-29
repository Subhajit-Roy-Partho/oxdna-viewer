# LLM Spatial API — grid, registry, outlines, crystals

This document is the complete reference for the oxView structures the LLM
agent can build and manipulate. The same text (condensed) lives in the
`SYSTEM_PROMPT` of `ts/llm_chat.js` and `AGENT_VIEWER_API` of
`ts/agent_chat.js`, which is what the model actually reads every turn.

Units everywhere are **oxDNA units** (1 unit ≈ 0.85 nm) unless noted.

## 1. Reference grid (`space.grid`)

* `space.grid(on?)` / `space.toggleGrid()` / `space.gridState()`
* Three.js convention: **Red=X, Green=Y, Blue=Z** (`AxesHelper` + `GridHelper`).
* **1 cell = 3 units ≈ 2.5 nm ≈ one duplex diameter.** The LLM can therefore
  reason in helix-steps ("move 3 right" ≈ "one helix over").
* Extent auto-fits the live scene bbox (min 60 units); numeric tick sprites
  read `X:+15`, `Z:-30`, …; sits just under the scene, centred on it in X/Z.
* Auto-shown when either AI panel opens.

## 2. Structure registry (`llmTracker`) + Ledger window

Every `shapes.*` tag lands in `llmTracker`. Each entry carries **name, kind,
live centroid, bbox, size, principal direction, colour, provenance,
timestamp**:

| method | notes |
|---|---|
| `tag(elems, name?, color?, kind?)` | kinds: `shape` (default), `duplex`, `edge`, `wireframe`, `copy`, `selection`, `import` |
| `alias(name, [members])` | group without re-clustering; recursive, cycle-safe |
| `resolve(name)` / `getByName(name)` | alias-aware, live re-query |
| `getByClusterId(cid)` / `getAll()` | |
| `list()` | `[{name, clusterId, size, kind}]` (registry entries) |
| `listDetailed()` | full live spatial records incl. aliases — **what the Ledger shows** |
| `info(name)` / `describe()` | one record \| null / multi-line text |
| `selectByName(name, keepPrev?)` / `focus(name)` | highlight / fly camera + notify |
| `colorByName(name, color)` / `rename(old, new)` | rename rewrites alias member refs |
| `deleteByName(name)` | alias name removes the **alias only**; entry removes elements |
| `clear()` / `status()` / `lastTag` / `lastClusterId` | |

**Structure Ledger window** (`windows/structureLedgerWindow.html`, ribbon
button **Ledger**, `view.toggleWindow('structureLedgerWindow', ledgerSetup)`):
table of name / kind / nt / position / size / direction with **Select**
(highlight region) and **Inspect** (fly camera there) per row, plus
Refresh / Fit-all / Grid buttons. The user clicks a row to check for
themselves whatever the LLM just built.

## 3. Spatial queries & transforms (`space`)

All transforms address objects **by name** so they survive the per-block
`new Function()` scope reset. Object = tracker name/alias, numeric
clusterId, `'selection'`, `'system0'…`, `'all'`.

| method | notes |
|---|---|
| `describe()` / `digest()` | text / structured scene digest; injected into the prompt every turn |
| `list()` / `info(name)` | names / full live record |
| `get(name)` / `centroid(name)` / `bbox(name)` / `size(name)` / `axis(name)` | |
| `moveTo(name,x,y,z)` / `moveBy(name,dx,dy,dz)` | via `translateElements` |
| `rotate(name, axis, deg, pivot?)` | pivot: centroid \| `'origin'` \| `[x,y,z]` \| other name |
| `align(name, worldDir)` | principal (PCA) axis → world dir; takes the shorter rotation |
| `place(name, {near, dir, gap})` | bbox-face placement, default gap 2 |
| `snapToGrid(name, cell?=3)` | centroid snapped to lattice |
| `duplicate(name, {offset?, newName?})` | `InstanceCopy` + `addElementsAt`, tagged kind `copy` |
| `rename` / `deleteObject` | delegate to tracker |
| `select(name, keepPrev?)` / `focus(name)` / `frameAll()` | user-facing inspection |
| `distance(a,b)` / `gap(a,b)` / `overlaps(a,b)` | centroid dist / AABB gap (neg = overlap depth) / bool |
| `angleBetween(a,b)` | degrees between PCA axes |
| `findNicks(threshold?=1.0)` | `[{aId,bId,dist}]` nearby 5′/3′ ends — query only |
| `ligateNearby(threshold?=1.5)` / `ligateAll(t)` | greedy closest-pair ligation; `{ligated, pairs}` |
| `countAll()` / `exportScene()` | counts / JSON digest to console + return |
| `snapshotImage(scale?)` / `show(name?)` | viewport PNG; `show` focuses first, displays in chat |

## 4. Shapes

### 4.1 Sketch shapes (single-strand nucleotide paths)

`line`, `circle`, `polygon`, `triangle`, `square`, `star`, `cube`,
`tetrahedron`, `sphere`, `helix`, `spiral`, `pointCloud`,
`basesForLength(len, spacing?)`. Each edge = one strand; auto-tagged.
Good for visualisation and quick mock-ups — **not** for DNA design (use §4.2).

### 4.2 Duplex outlines (real B-DNA, auto-connected)

Ideal B-DNA duplexes (`edit.createStrand(seq, true)`), one per edge, oriented
along the edge via the PCA helix axis, then auto-ligated at shared vertices
by greedy closest 5′/3′ pairing — the viewer figures out where to connect.
Length → bp at **0.4 units/bp** (min 6 bp/edge). Relax with oxDNA afterwards.

* `shapes.duplexEdge(p0, p1, seq?, isRNA?, tag?)` — one duplex (kind `duplex`).
* `shapes.outline(points, {closed=true, seq?, isRNA?, tag='outline', ligate=true, threshold=1.5})` —
  arbitrary wireframe. With `tag`: edges `tag_e0…` (kind `edge`), whole shape
  = alias `tag`. Returns elems with `.edges`, `.ligated`, `.pairs`.
* `shapes.triangleDuplex(center, normal, sideLen, seq?, isRNA?, tag?)` —
  equilateral duplex triangle (outline wrapper).
* `shapes.triLattice(nx, ny, sideLen, center?, normal?)` — **pure geometry**,
  no scene change: `{verts, edges:[[a,b]], cells:[{verts:[a,b,c], up}]}` on a
  60° (u,v) basis with unique edges.
* `shapes.triangleCrystal(center, normal, sideLen, nx, ny, nz, {tag='crystal', seq?, isRNA?, layerGap=sideLen*0.5, twistDeg=0, shift=[0,0], threshold=2.0})` —
  layered slab: one duplex per **unique** lattice edge per layer (no doubling),
  auto-ligated at in-plane vertices. Registry: edges `tag_L{l}_e{k}`, cell
  aliases `tag_L{l}_c{i}` (3 edges each), layer aliases `tag_L{l}`, whole
  alias `tag`. `twistDeg` + `shift` per layer mimic tensegrity-triangle R3
  screw stacking. Returns elems with `.edges/.cells/.layers/.ligated`.

Design notes (from the literature survey):

* PERDIX (Jun et al., *Sci Adv* 2019): outline → duplex edges + spanning-tree
  scaffold routing + 0.42 nm/nt unpaired vertex rule, min DX edge 38 bp.
  We use single-duplex edges (min 6 bp) and greedy end-ligation instead of the
  dual-graph routing — same outline→DNA idea at wireframe scale.
* Triangular meshes are stiffer than quadrilateral ones (PERDIX AFM) —
  triangles are the right primitive for crystals.
* Tensegrity-triangle crystals (Seeman; Zhang et al. 2018): 2–4-turn edges,
  sticky-end cohesion, rhombohedral stacking — our `layerGap`/`twistDeg`/
  `shift` are the coarse controls for the same stacking.
* caDNAno-agent lesson (2026): verify geometry indirectly — we do it via
  `.ligated` counts, `.pairs` distances, `space.overlaps`, and `space.describe`
  after every build step.

## 5. Canonical workflow: triangle → crystal

```js
// 1. Small duplex triangle (prompt: "make a small DNA triangle"):
var tri = shapes.triangleDuplex(
  new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 12, null, false, 'tri1');
notify('tri1: ' + tri.length + ' nt, ' + tri.ligated + ' vertex connections');
space.show('tri1');            // user sees it; snapshot in chat
// 2. Verify: closed triangle routes BOTH duplex strands around (6 ligations);
//    pairs all < 1.5u; overlaps('tri1', <others>) false.
// 3. Grow to a crystal slab with the same edge length:
shapes.triangleCrystal(
  new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 12, 2, 2, 2, {tag:'xtal1'});
space.describe();              // per-edge / per-cell / per-layer digest
space.show('xtal1');
```

## 6. LLM endpoint configuration (oxView ↔ NanoCanvas parity)

Both chats use OpenAI-compatible `/chat/completions` (NanoCanvas
`src/llm/nanogpt.js` triple: 120 s timeout, 3 retries with backoff,
classified errors). Precedence:

* key: `oxview_llm_api_key` (💬) / `oxview_agent_api_key` (🤖) →
  `OXVIEW_CONFIG.llmApiKey/agentApiKey` (`ts/config.js`, gitignored) →
  **NanoCanvas `nc_ai_key`** → '' (chat shows the 🔑 fix hint).
* baseURL / model: `OXVIEW_CONFIG.*` → **`nc_ai_url` / `nc_ai_model`** →
  `https://nano-gpt.com/api/v1` / `z-ai/glm-5.3:thinking`.

A key saved in either tool works in the other. Live keys live only in
gitignored `ts/config.js` (copy from `ts/config.example.js`) or browser
localStorage — never in git.
