/**
 * Agent Chat — Multi-agent LangGraph-style pipeline for oxDNA viewer
 *
 * Pipeline: Planner → [Executor → Observer → (retry?)] × N → Summarizer
 *
 * ─────────────────────────────────────────────────────────────────────
 * API KEY SETUP (Anthropic claude-haiku or claude-sonnet):
 *   Option 1: Click the 🔑 button in the Agent AI panel at runtime.
 *             Key is saved in localStorage under 'oxview_agent_api_key'.
 *   Option 2: Hardcode below for development (not recommended for prod).
 *
 * KEY EXHAUSTION: 401 / 403 / 429 errors are surfaced in the panel.
 * ─────────────────────────────────────────────────────────────────────
 */

const AGENT_CONFIG = {
    // NanoCanvas parity — see LLM_CONFIG in llm_chat.js. Agent panel key
    // (oxview_agent_api_key) wins, then agentApiKey, then the shared LLM key,
    // then NanoCanvas's nc_ai_* keys.
    get baseURL() {
        return (window.OXVIEW_CONFIG || {}).agentBaseURL
            || (window.OXVIEW_CONFIG || {}).llmBaseURL
            || localStorage.getItem('nc_ai_url')
            || "https://nano-gpt.com/api/v1";
    },
    get model() {
        return (window.OXVIEW_CONFIG || {}).agentModel
            || (window.OXVIEW_CONFIG || {}).llmModel
            || localStorage.getItem('nc_ai_model')
            || "z-ai/glm-5.3:thinking";
    },
    get apiKey() {
        return localStorage.getItem('oxview_agent_api_key')
            || (window.OXVIEW_CONFIG || {}).agentApiKey
            || (window.OXVIEW_CONFIG || {}).llmApiKey
            || localStorage.getItem('nc_ai_key')
            || '';
    }
};

// Send-to-maintainer (Telegram) bot-token default. Intentional public
// default per maintainer decision (bot @SubhoGilaBot, name Gila) so
// contact works out of the box; the exposure tradeoff was explicitly
// accepted. Precedence (user-set values keep winning):
//   ts/config.js gitignored override (OXVIEW_CONFIG.telegramBotToken)
//   → localStorage user value ('oxview_telegram_bot_token', then
//     NanoCanvas-shared 'nc_telegram_bot_token')
//   → built-in default below.
// The target chat ID intentionally has NO default — it stays empty
// until the user pastes one.
const TELEGRAM_BOT_TOKEN_DEFAULT =
    "8794105541:AAGcw_74574BVbvAexrqhfHUJZVM1DtHlmw";
function resolveTelegramBotToken() {
    return (window.OXVIEW_CONFIG || {}).telegramBotToken
        || localStorage.getItem('oxview_telegram_bot_token')
        || localStorage.getItem('nc_telegram_bot_token')
        || TELEGRAM_BOT_TOKEN_DEFAULT;
};

const AGENT_MAX_RETRIES = 3;

// ─────────────────────────────────────────────────────────────
// Viewer API reference shared by all agents
// ─────────────────────────────────────────────────────────────
const AGENT_VIEWER_API = `
════════════════════════════════════════
GLOBAL STATE (always accessible)
════════════════════════════════════════
systems          : System[]         — all loaded systems; systems[0] is the first
elements         : ElementMap       — Map<id, BasicElement> of every element
selectedBases    : Set<BasicElement>— currently selected elements
box              : THREE.Vector3    — simulation box dimensions
scene            : THREE.Scene      — THREE.js scene
camera           : THREE.Camera     — active camera
editHistory      : EditHistory      — undo/redo stack
    editHistory.undo(); render();   // undo last edit
    editHistory.redo(); render();   // redo last undone edit

════════════════════════════════════════
api.* — SCENE & VISUALIZATION
════════════════════════════════════════
api.getElements(ids: number[])                        → BasicElement[]
api.selectElementIDs(ids: number[], keepPrev?: bool)  → void
api.selectElements(elems: BasicElement[], keepPrev?)  → void
api.findElement(element: BasicElement, steps?: number) → void
api.highlight5ps(system?: System)                     → void
api.highlight3ps(system?: System)                     → void
api.toggleStrand(strand: Strand)                      → Strand
api.toggleElements(elems: BasicElement[])             → void
api.toggleAll(system?: System)                        → void
api.toggleBaseColors()                                → void
api.countStrandLength(system?: System)                → {[len]: Strand[]}
api.trace53(element: BasicElement)                    → BasicElement[]
api.trace35(element: BasicElement)                    → BasicElement[]
api.switchCamera()                                    → void
api.setBackgroundColor(color: string)                 → void
api.showColorbar()                                    → void
api.removeColorbar()                                  → void
api.changeColormap(name: string)                      → void
api.setColorBounds(min: number, max: number)          → void
api.showEverything()                                  → void

════════════════════════════════════════
edit.* — STRUCTURE EDITING
════════════════════════════════════════
edit.createStrand(sequence, createDuplex?, isRNA?)    → BasicElement[]
    Returns: [0]=first top-strand nucleotide, [1]=first bottom-strand nucleotide, then rest.
    Get strands: elems[0].strand (top), elems[1].strand (bottom). NEVER use elems[0].pair.strand.
    CRITICAL: if calling createStrand more than once, translateElements the first result away
    BEFORE the second call — both place at the same camera position and findPair() will
    incorrectly match across duplexes, leaving .pair undefined.
      var d1 = edit.createStrand(seq, true);
      translateElements(new Set(d1.filter(Boolean)), new THREE.Vector3(10, 0, 0));
      var d2 = edit.createStrand(seq, true); // now safe
edit.extendStrand(end: BasicElement, sequence)        → BasicElement[]
edit.extendDuplex(end: Nucleotide, sequence)          → BasicElement[]
    Physically extend a duplex from a terminal nucleotide, growing the helix geometry.
    Use this — not ligate — when you want a longer physically valid duplex.
    Example: edit.extendDuplex(systems[0].strands[0].end3, 'AAAGGG');
edit.deleteElements(victims: BasicElement[])          → void
    Each element has a .color property (THREE.Color or undefined). Use it to delete by colour:
      var toDelete = [];
      systems.forEach(function(sys){ sys.getMonomers().forEach(function(e){
        var c = e.color; if (c && c.b > 0.6 && c.r < 0.4) toDelete.push(e); // blue
      }); });
      edit.deleteElements(toDelete); render();
edit.nick(element: BasicElement)                      → void
edit.ligate(a: BasicElement, b: BasicElement)         → void
    Purely topological — does NOT move or reposition atoms.
    Only call when ends are already physically adjacent. For end-to-end extension use extendDuplex.
edit.skip(elems: BasicElement[])                      → void
edit.insert(e: BasicElement, sequence)                → BasicElement[]
edit.getSequence(elems: Set<BasicElement>)            → string
edit.setSequence(elems: Set<BasicElement>, seq, setComplementary?) → void
edit.createBP(elem: Nucleotide, undoable?)            → Nucleotide
edit.interconnectDuplex3p(strand1, strand2, patchSeq?) → void
edit.interconnectDuplex5p(strand1, strand2, patchSeq?) → void
edit.addElementsAt(copies: InstanceCopy[], pos?)      → BasicElement[]
edit.addElements(copies: InstanceCopy[])              → BasicElement[]
edit.move_to(target: BasicElement, toDisplace: BasicElement[]) → void

════════════════════════════════════════
GLOBAL TRANSFORM FUNCTIONS
════════════════════════════════════════
translateElements(elements: Set<BasicElement>, v: THREE.Vector3) → void
rotateElements(elements, axis: THREE.Vector3, angle: number, about: THREE.Vector3) → void
rotateElementsByQuaternion(elements, q: THREE.Quaternion, about?) → void

════════════════════════════════════════
api.* — ROTATION & PCA (transform_api.js)
════════════════════════════════════════
api.getCOM(elems: BasicElement[])  → THREE.Vector3
    Centre of mass of an array of elements.

api.rotateGroup(elems, axis: THREE.Vector3, angleDeg: number, pivot?: THREE.Vector3) → void
    Rotate a group of elements around an axis by angleDeg degrees.
    pivot defaults to group centre of mass.
    Example — rotate all monomers 90° around Y:
      api.rotateGroup(systems[0].getMonomers(), new THREE.Vector3(0,1,0), 90);

api.rotateSingle(elem, axis: THREE.Vector3, angleDeg: number, pivot?: THREE.Vector3) → void
    Rotate a single element. pivot defaults to the element's own position.
    Example:
      api.rotateSingle(api.getElements([3])[0], new THREE.Vector3(1,0,0), 45);

api.rotateCluster(clusterId: number, axis, angleDeg, pivot?) → void
    Rotate all elements sharing a clusterId.
    Example: api.rotateCluster(2, new THREE.Vector3(0,1,0), 30);

api.getPCA(elems: BasicElement[]) → { primaryAxis, secondaryAxis, tertiaryAxis, eigenvalues[3], center, spread }
    Principal Component Analysis. primaryAxis = direction of greatest variance = helix axis for a duplex.
    Example — find helix axis and align it to Y:
      var pca = api.getPCA(systems[0].getMonomers());
      var q = new THREE.Quaternion().setFromUnitVectors(pca.primaryAxis, new THREE.Vector3(0,1,0));
      rotateElementsByQuaternion(new Set(systems[0].getMonomers()), q, pca.center);
      render();

════════════════════════════════════════
llmTracker — LLM nucleotide registry (llm_tracker_api.js)
════════════════════════════════════════
llmTracker.tag(elems, name?: string, color?) → clusterId: number
    Assign a new clusterId to elems and register under name.
    Example: llmTracker.tag(myElems, 'duplex1', new THREE.Color(0,1,0));

llmTracker.getByName(name: string)    → BasicElement[]
llmTracker.getByClusterId(id: number) → BasicElement[]
llmTracker.getAll()                   → BasicElement[]  — all LLM-tagged elements
llmTracker.list()                     → [{name, clusterId, size}]
llmTracker.deleteByName(name: string) → void   — deletes elements and unregisters tag
llmTracker.clear()                    → void   — delete ALL LLM-tagged elements
llmTracker.status()                   → void   — notify + console.log registry
llmTracker.selectByName(name: string) → void
llmTracker.colorByName(name, color)   → void
llmTracker.lastTag                    : string|null
llmTracker.lastClusterId              : number

CRITICAL — Always re-acquire by name (never store the BasicElement[] across blocks):
  var elems = llmTracker.getByName('duplex1');

════════════════════════════════════════
shapes.* — Shape drawing (shapes_api.js)
════════════════════════════════════════
All shapes place DNA (or RNA) nucleotides at geometric positions and auto-tag via llmTracker.
Spacing: 1 oxDNA unit ≈ 0.85 nm. Use ~1 unit spacing for natural-looking backbones.
shapes.basesForLength(length, spacing?=1) → number  — recommended base count for a given edge length

shapes.line(p1, p2, nBases, seq?, isRNA?, tagName?)
    Strand along straight line p1→p2.
    Example: shapes.line(new THREE.Vector3(0,0,0), new THREE.Vector3(10,0,0), 12, null, false, 'myLine');

shapes.circle(center, normal, radius, nBases, seq?, isRNA?, tagName?)
    Closed-loop strand around a circle. normal = plane normal (e.g. new THREE.Vector3(0,1,0)).
    Example: shapes.circle(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 8, 24, null, false, 'ring');

shapes.polygon(nSides, center, normal, radius, basesPerSide, seq?, isRNA?, tagName?)
    Regular n-gon. Each edge is a separate strand.
    Example (hexagon): shapes.polygon(6, new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 10, 8, null, false, 'hex');

shapes.triangle(center, normal, sideLength, basesPerSide, seq?, isRNA?, tagName?)
    Equilateral triangle. sideLength in oxDNA units.
    Example: shapes.triangle(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 12, 8, null, false, 'tri');

shapes.square(center, normal, sideLength, basesPerSide, seq?, isRNA?, tagName?)
    Example: shapes.square(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 10, 8, null, false, 'sq');

shapes.star(center, normal, outerRadius, innerRadius, numPoints, basesPerEdge, seq?, isRNA?, tagName?)
    N-pointed star outline (zig-zag between outer and inner vertices). 2*numPoints edges.
    Example (5-point star in XY plane): shapes.star(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 10, 4, 5, 6, null, false, 'star1');

shapes.cube(center, sideLength, basesPerEdge, seq?, isRNA?, tagName?)
    Nucleotides along all 12 edges of a cube.
    Example: shapes.cube(new THREE.Vector3(0,0,0), 10, 5, null, false, 'myCube');

shapes.tetrahedron(center, sideLength, basesPerEdge, seq?, isRNA?, tagName?)
    6 edges of a tetrahedron.
    Example: shapes.tetrahedron(new THREE.Vector3(0,0,0), 10, 6, null, false, 'tetra');

shapes.sphere(center, radius, nBases, seq?, isRNA?, tagName?)
    Fibonacci-lattice sphere surface.
    Example: shapes.sphere(new THREE.Vector3(0,0,0), 8, 50, null, false, 'ball');

shapes.helix(center, axis, radius, risePerBase, turns, nBases, seq?, isRNA?, tagName?)
    Custom helical path (distinct from DNA helix geometry).

shapes.duplexEdge(p0, p1, seq?, isRNA?, tag?)
    One ideal B-DNA duplex along p0→p1 (length/0.4 bp, min 6). Registered kind 'duplex'.
    Example: shapes.duplexEdge(new THREE.Vector3(0,0,0), new THREE.Vector3(12,0,0), null, false, 'edge1');

shapes.outline(points, {closed?, seq?, isRNA?, tag?, ligate?, threshold?})
    Duplex wireframe along a polyline; auto-ligates meeting ends at vertices.
    Edges tagged tag_e0… (kind 'edge'), whole shape = alias tag.
    Returns elems with .edges/.ligated/.pairs.
    Example: shapes.outline([new THREE.Vector3(0,0,0), new THREE.Vector3(12,0,0), new THREE.Vector3(6,10.4,0)], {tag:'tri1'});

shapes.triangleDuplex(center, normal, sideLen, seq?, isRNA?, tag?)
    Equilateral duplex triangle (outline wrapper). sideLen in oxDNA units.
    Example: shapes.triangleDuplex(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 12, null, false, 'tri1');

shapes.triLattice(nx, ny, sideLen, center?, normal?)
    Pure geometry {verts, edges:[[a,b]], cells:[{verts:[a,b,c], up}]} — no scene change.

shapes.triangleCrystal(center, normal, sideLen, nx, ny, nz, {tag?, seq?, isRNA?, layerGap?, twistDeg?, shift?, threshold?})
    Layered crystal slab: one duplex per UNIQUE lattice edge, auto-ligated at vertices.
    Registry: tag_L{l}_e{k} edges, tag_L{l}_c{i} cell aliases, tag_L{l} layer aliases, tag whole alias.
    Example: shapes.triangleCrystal(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 12, 2, 2, 2, {tag:'xtal1'});
    Example: shapes.helix(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 3, 0.4, 3, 30, null, false, 'coil');

shapes.spiral(center, normal, startRadius, endRadius, turns, nBases, seq?, isRNA?, tagName?)
    Archimedean spiral in a plane.

shapes.pointCloud(points: THREE.Vector3[], seq?, isRNA?, tagName?)
    One nucleotide at each arbitrary 3-D point.
    Example:
      var pts = [new THREE.Vector3(0,0,0), new THREE.Vector3(2,0,0), new THREE.Vector3(1,2,0)];
      shapes.pointCloud(pts, null, false, 'cloud');

════════════════════════════════════════
space.* — SPATIAL AWARENESS & OBJECT-ADDRESSED TRANSFORMS (spatial_api.js)
════════════════════════════════════════
An "object" is a named group: a shapes.* / llmTracker tag, a clusterId number
or 'cluster7' string, 'selection', or 'system0'/'system1'. Names are global — they survive the per-step
scope reset, so ALWAYS transform by name, never by re-capturing element arrays.
The CURRENT SCENE block above is space.describe() — trust it for positions.

space.describe()                       → text digest of every object
space.digest()                         → {objects:[{name,kind,count,centroid,bbox,size,axis,color}], box, grid}
space.list() / space.info(name)        → [names] / full live record | null
space.get(name) / space.centroid(name) / space.bbox(name) / space.size(name) / space.axis(name)
space.moveTo(name, x, y, z)            → centroid → (x,y,z)
space.moveBy(name, dx, dy, dz)
space.rotate(name, axis, deg, pivot?)  → axis [x,y,z] or 'x'|'y'|'z'; pivot undefined(centroid)|'origin'|[x,y,z]|otherName
space.align(name, worldDir)            → point the object's principal axis along worldDir
space.place(name, {near, dir, gap})    → move so its bbox is 'gap' units from object 'near' along dir ('x'|'-x'|[x,y,z])
space.snapToGrid(name, cell?) / space.duplicate(name, {offset?, newName?})
space.rename(old, new) / space.deleteObject(name)
space.select(name, keepPrev?) / space.focus(name) / space.frameAll()
space.listClusters()                   → [{id,label,size}] ALL native clusters (DBSCAN/rigidDNA/manual), not just tags
space.selectCluster(id, keepPrev?) / space.nameCluster(id, name) / space.clusterSelection(name?) → selection→cluster, returns id
space.autoClusterRigidDna()            → async helix-geometry clustering (rigidDNA window section 1, headless)
space.relaxRigidDna({steps?,dt?,k?,b?,repulsion?,...}) → async rigidDNA relax + apply to scene (headless, single run)
space.distance(a,b) / space.gap(a,b)   → centroid distance / min bbox gap (negative = overlap)
space.overlaps(a,b)                    → bool  (check before/after placing multiple shapes)
space.angleBetween(a,b)                → degrees between principal axes
space.findNicks(threshold?)            → [{aId,bId,dist}] nearby 5'/3' ends (query only)
space.ligateNearby(threshold?)          → {ligated, pairs} auto-connect nearby ends
space.countAll() / space.exportScene()
space.snapshotImage(scale?)           → PNG dataURL ;  space.show(name?) → focus + snapshot in chat
space.grid(on?) / space.toggleGrid()

// Place two shapes side by side without overlap, then verify:
shapes.star(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 10, 4, 5, 6, null, false, 'starA');
shapes.cube(new THREE.Vector3(0,0,0), 8, 5, null, false, 'cubeB');
space.place('cubeB', {near:'starA', dir:'x', gap:3});
notify('overlap? ' + space.overlaps('starA','cubeB'));

// Duplex outlines (real B-DNA, auto-ligated at vertices) + triangle → crystal:
var tri = shapes.triangleDuplex(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 12, null, false, 'tri1');
notify('tri1: ' + tri.length + ' nt, ' + tri.ligated + ' vertex connections'); // expect 3
shapes.triangleCrystal(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 12, 2, 2, 2, {tag:'xtal1'});
space.show('xtal1');
// shapes.outline(points, {tag, closed?, ligate?, threshold?}) — arbitrary wireframes
// shapes.triLattice(nx,ny,sideLen,center?,normal?) — pure lattice geometry {verts,edges,cells}
// llmTracker.listDetailed()/info(name)/describe() — registry with live position/size/direction
// Ledger window (view.toggleWindow('structureLedgerWindow')) — user browses/selects/inspects regions

════════════════════════════════════════
SYSTEM & ELEMENT METHODS
════════════════════════════════════════
system.getMonomers()   → BasicElement[]
system.strands         : Strand[]
strand.getMonomers()   → BasicElement[]
strand.end5 / strand.end3 : BasicElement
element.getPos()       → THREE.Vector3
element.getA1()        → THREE.Vector3   (base-pair axis, outward from backbone)
element.getA3()        → THREE.Vector3   (stacking axis, along helix)
element.strand         : Strand
element.pair           : Nucleotide|null
element.n3 / element.n5 : BasicElement
element.id             : number
element.clusterId      : number
element.isPaired()     → bool
element.changeType(base: string) → void

════════════════════════════════════════
UI HELPERS
════════════════════════════════════════
notify(message, type?, keepOpen?, title?)
    type: 'success'|'warning'|'alert'|'info'

ask(title, content, onYes?, onNo?)

colorElements(color?, elems?)
    IMPORTANT: elems is BasicElement[] (not a Set). If omitted, uses Array.from(selectedBases).
    If selectedBases is empty and elems is not given, shows a warning and colours NOTHING.
    colorElements() also clears the selection (selectedBases) after colouring.
    ALWAYS pass elems explicitly — never rely on implicit selection state.
      colorElements(new THREE.Color(1,0,0), Array.from(selectedBases)); // colour selection
      colorElements(new THREE.Color(1,0,0), systems[0].getMonomers());  // colour all
      colorElements(new THREE.Color(0,0,1), api.getElements([0,1,2])); // colour by ID

updateColoring(mode?)   — modes: 'Overlay','Strand','Custom','Position','Base','Index','Cluster'
resetCustomColoring()   — reset to Strand mode
view.toggleWindow(id, oncreate?)
view.saveCanvasImage(scaleFactor?)
resetScene(resetCamera?)
findBasepairs(minLen?)

CRITICAL SCOPE RULE:
Each code block runs in its own new Function() scope. Variables from prior blocks (d1, d2, seq, etc.)
DO NOT EXIST. Always re-acquire references from global state:
  var allMonomers = [];
  systems.forEach(function(sys){ allMonomers = allMonomers.concat(sys.getMonomers()); });
  var clusterIds = Array.from(new Set(allMonomers.map(function(e){ return e.clusterId; }))).sort(function(a,b){ return a-b; });
  var c1elems = allMonomers.filter(function(e){ return e.clusterId === clusterIds[clusterIds.length-2]; });
  var c2elems = allMonomers.filter(function(e){ return e.clusterId === clusterIds[clusterIds.length-1]; });

CRITICAL SELECTION RULES:
- colorElements(color) alone does NOTHING if selectedBases is empty. Always pass elems explicitly.
- Capture selectedBases into a local var BEFORE calling colorElements (it clears selection afterwards):
    var targets = Array.from(selectedBases);
    colorElements(new THREE.Color(1,0,0), targets);
- edit.deleteElements / edit.getSequence / edit.setSequence: pass selectedBases (a Set) directly.
- To delete by colour ("remove the blue duplex"), filter on element.color (THREE.Color) — NEVER guess by clusterId:
    var toDelete = [];
    systems.forEach(function(sys){ sys.getMonomers().forEach(function(e){
      var c = e.color;
      if (c && c.b > 0.6 && c.r < 0.4) toDelete.push(e); // blue
    }); });
    edit.deleteElements(toDelete); render();
  Common thresholds:
    red: c.r>0.6&&c.g<0.4&&c.b<0.4  green: c.g>0.6&&c.r<0.4&&c.b<0.4
    blue: c.b>0.6&&c.r<0.4           yellow: c.r>0.7&&c.g>0.5&&c.b<0.3
`;

// ─────────────────────────────────────────────────────────────
// Agent system prompts
// ─────────────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a planning agent for oxDNA viewer (oxView), a 3D molecular visualization and editing tool for DNA/RNA nanostructures.

Given a user's task, decompose it into 1-5 concrete, sequential steps that JavaScript can execute.
For simple single-action tasks, return just 1 step.
For complex tasks, break them into logical ordered sub-tasks.

Rules:
- Respond with ONLY a JSON array of step description strings — no markdown, no explanation.
- Each step is a clear imperative action: "Select all nucleotides in system 0", "Color selected elements red".
- Maximum 5 steps.
- Order steps so each builds on the previous.
- For colouring tasks: always specify WHAT to colour explicitly in the step description.
  Use "Color all nucleotides in system 0 red" (not just "Color red") so the executor knows the target without relying on implicit selection state.

Example: ["Select all nucleotides in system 0", "Color the selection blue", "Zoom camera to the selection"]`;

const EXECUTOR_SYSTEM = `You are a code execution agent for oxDNA viewer (oxView), a 3D molecular visualization and editing tool for DNA/RNA nanostructures.

Given a single step description, generate the JavaScript code to perform exactly that step.
Respond with ONLY valid JavaScript — no explanations, no markdown, no code blocks. Always end with render();

${AGENT_VIEWER_API}

COMMON PATTERNS:
// Move system 0 COM to (x,y,z):
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
translateElements(new Set(monomers), new THREE.Vector3(X,Y,Z).sub(com));
render();

// Color the currently selected elements red (capture before colorElements clears selection):
var targets = Array.from(selectedBases);
if (targets.length === 0) {
    notify('No elements selected', 'warning');
} else {
    colorElements(new THREE.Color(1, 0, 0), targets);
    render();
}

// Color ALL elements in system 0 red (no selection needed):
colorElements(new THREE.Color(1, 0, 0), systems[0].getMonomers());
render();

// Select all in system 0 (api.selectElements calls render() internally):
api.selectElements(systems[0].getMonomers());

// OXDNA UNIT REFERENCE: 1 oxDNA unit ≈ 0.85 nm.
// DNA duplex diameter ≈ 2.35 oxDNA units. Adjacent parallel duplexes: ~3 units centre-to-centre.
// NEVER use offsets > 5 for "next to each other" — that places duplexes far apart visually.

// Create two duplexes side by side (~3 units apart):
var seq = 'ATCGATCGATCGATCGATCG';
var d1 = edit.createStrand(seq, true);
var com1 = new THREE.Vector3();
d1.filter(Boolean).forEach(function(e){ com1.add(e.getPos()); });
com1.divideScalar(d1.filter(Boolean).length);
translateElements(new Set(d1.filter(Boolean)), com1.clone().negate());
var d2 = edit.createStrand(seq, true);
var com2 = new THREE.Vector3();
d2.filter(Boolean).forEach(function(e){ com2.add(e.getPos()); });
com2.divideScalar(d2.filter(Boolean).length);
translateElements(new Set(d2.filter(Boolean)), new THREE.Vector3(3, 0, 0).sub(com2));
render();

// Extend an existing duplex end-to-end (PREFERRED — physically grows the helix):
var elems = edit.createStrand('ATCGATCGATCGATC', true);
edit.extendDuplex(elems[0].strand.end3, 'GCTAGCTAGCTAGCT');
render();

// Ligate two already-adjacent duplexes using clusterId (robust strand lookup):
// ONLY use ligate when ends are physically adjacent — it does NOT move atoms.
var allMonomers = [];
systems.forEach(function(sys){ allMonomers = allMonomers.concat(sys.getMonomers()); });
var clusterIds = Array.from(new Set(allMonomers.map(function(e){ return e.clusterId; }))).sort(function(a,b){ return a-b; });
var c1 = clusterIds[clusterIds.length-2];
var c2 = clusterIds[clusterIds.length-1];
var allStrands = [];
systems.forEach(function(sys){ allStrands = allStrands.concat(sys.strands); });
var s1 = allStrands.filter(function(s){ return s.getMonomers().some(function(e){ return e.clusterId===c1; }); });
var s2 = allStrands.filter(function(s){ return s.getMonomers().some(function(e){ return e.clusterId===c2; }); });
edit.ligate(s1[0].end3, s2[0].end5);
edit.ligate(s2[1].end3, s1[1].end5);
render();

// Set the angle between two ligated duplexes (e.g., 60 degrees):
//
// CRITICAL — junction point: do NOT use "closest physical atom pair" — for
// parallel side-by-side duplexes that pair is in the middle of the structure,
// not at the ligation point. Instead, traverse backbone bonds to find the
// cross-cluster connection (the actual ligation bond).
//
// SIGN: deltaAngle = targetAngle - currentAngle  (NOT currentAngle - targetAngle)
var allMonomers = [];
systems.forEach(function(sys){ allMonomers = allMonomers.concat(sys.getMonomers()); });
var clusterIds = Array.from(new Set(allMonomers.map(function(e){ return e.clusterId; }))).sort(function(a,b){ return a-b; });
var c1 = clusterIds[clusterIds.length-2];
var c2 = clusterIds[clusterIds.length-1];
var e1 = allMonomers.filter(function(e){ return e.clusterId === c1; });
var e2 = allMonomers.filter(function(e){ return e.clusterId === c2; });
var com1 = new THREE.Vector3(), com2 = new THREE.Vector3();
e1.forEach(function(e){ com1.add(e.getPos()); }); com1.divideScalar(e1.length);
e2.forEach(function(e){ com2.add(e.getPos()); }); com2.divideScalar(e2.length);
// Find true junction: look for a backbone bond that crosses cluster boundary
var juncA = null, juncB = null;
allMonomers.forEach(function(e) {
    if (e.clusterId === c1) {
        if (e.n3 && e.n3.clusterId === c2 && !juncA) { juncA = e; juncB = e.n3; }
        if (e.n5 && e.n5.clusterId === c2 && !juncA) { juncA = e; juncB = e.n5; }
    }
});
var junction = juncA ? juncA.getPos().clone().add(juncB.getPos()).multiplyScalar(0.5) : com1.clone();
// Direction vectors from junction out along each duplex arm
var dir1 = com1.clone().sub(junction).normalize();
var dir2 = com2.clone().sub(junction).normalize();
// Rotation axis: perpendicular to the plane of the two duplex arms
var rotAxis = new THREE.Vector3().crossVectors(dir1, dir2).normalize();
// Fallback when arms are nearly parallel/antiparallel: pick an axis ⊥ to dir1
if(rotAxis.lengthSq() < 0.01) {
    var perp = (Math.abs(dir1.x) < 0.9) ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,0,1);
    rotAxis = new THREE.Vector3().crossVectors(dir1, perp).normalize();
}
// Measure current angle and rotate e2 by the exact delta needed
var currentAngle = Math.acos(Math.max(-1, Math.min(1, dir1.dot(dir2))));
var targetAngle = Math.PI / 3; // 60 degrees — change as needed
var deltaAngle = targetAngle - currentAngle; // CORRECT SIGN
rotateElements(new Set(e2), rotAxis, deltaAngle, junction);
render();

// Create a Holliday junction (X-shaped four-way DNA junction):
// Two 20-bp duplexes nicked and cross-ligated at their midpoints.
var seq = 'ATCGATCGATCGATCGATCG';
var d1 = edit.createStrand(seq, true);
translateElements(new Set(d1.filter(Boolean)), new THREE.Vector3(0, 10, 0));
var d2 = edit.createStrand(seq, true);
var s0 = d1[0].strand, s1_ = d1[1].strand;
var s2 = d2[0].strand, s3 = d2[1].strand;
var d2elems = d2.filter(Boolean);
var com1 = new THREE.Vector3(), com2 = new THREE.Vector3();
d1.filter(Boolean).forEach(function(e){ com1.add(e.getPos()); });
com1.divideScalar(d1.filter(Boolean).length);
d2elems.forEach(function(e){ com2.add(e.getPos()); });
com2.divideScalar(d2elems.length);
translateElements(new Set(d2elems), new THREE.Vector3(2.3, 0, 0).add(com1).sub(com2));
// nick(s0m[9]) → s0m[9].n3=null (3' terminal), s0m[10].n5=null (5' terminal)
// ligate(s0m[9], s2m[10]) succeeds because !a.n3 && !b.n5
var s0m = s0.getMonomers(), s1m = s1_.getMonomers();
var s2m = s2.getMonomers(), s3m = s3.getMonomers();
edit.nick(s0m[9]); edit.nick(s1m[9]);
edit.nick(s2m[9]); edit.nick(s3m[9]);
edit.ligate(s0m[9], s2m[10]); edit.ligate(s2m[9], s0m[10]);
edit.ligate(s1m[9], s3m[10]); edit.ligate(s3m[9], s1m[10]);
// Colour the 4 resulting strands (ligate updates element.strand pointers)
colorElements(new THREE.Color(0.9,0.1,0.1), s0m[0].strand.getMonomers());
colorElements(new THREE.Color(0.1,0.5,0.9), s2m[0].strand.getMonomers());
colorElements(new THREE.Color(0.1,0.8,0.1), s1m[0].strand.getMonomers());
colorElements(new THREE.Color(0.9,0.7,0.1), s3m[0].strand.getMonomers());
notify('Holliday junction created', 'success');
render();

// Draw a triangle of DNA and colour it red:
shapes.triangle(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 12, 8, null, false, 'tri');
colorElements(new THREE.Color(1,0,0), llmTracker.getByName('tri'));
render();

// Draw a cube and colour it blue:
shapes.cube(new THREE.Vector3(0,0,0), 10, 5, null, false, 'myCube');
colorElements(new THREE.Color(0,0.4,1), llmTracker.getByName('myCube'));
render();

// Draw a DNA circle (ring) in the XZ plane:
shapes.circle(new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0), 8, 24, null, false, 'ring');
render();

// Draw a sphere of nucleotides and colour it green:
shapes.sphere(new THREE.Vector3(0,0,0), 8, 50, null, false, 'ball');
colorElements(new THREE.Color(0,0.8,0.2), llmTracker.getByName('ball'));
render();

// Rotate a named group 45° around Y through its own centre of mass:
var grp = llmTracker.getByName('tri');
api.rotateGroup(grp, new THREE.Vector3(0,1,0), 45);

// Find the helix axis of system 0 and align it to Y:
var pca = api.getPCA(systems[0].getMonomers());
var q = new THREE.Quaternion().setFromUnitVectors(pca.primaryAxis, new THREE.Vector3(0,1,0));
rotateElementsByQuaternion(new Set(systems[0].getMonomers()), q, pca.center);
render();

// Tag newly created elements and retrieve them later:
var newElems = edit.createStrand('ATCGATCG', true);
llmTracker.tag(newElems.filter(Boolean), 'myDuplex', new THREE.Color(1,0.5,0));
// In the NEXT code block, retrieve by name — never store elems across blocks:
var myElems = llmTracker.getByName('myDuplex');
api.rotateGroup(myElems, new THREE.Vector3(0,1,0), 30);
render();`;

const OBSERVER_SYSTEM = `You are a code verification agent for oxDNA viewer. Evaluate whether a step executed correctly.

You receive:
- The step description (what should happen)
- The JavaScript code that was executed
- The execution result ("SUCCESS" or an error message starting with "ERROR:")

Determine if the step completed successfully and respond with ONLY a JSON object (no markdown):
{"success": true, "feedback": "brief note"}
or
{"success": false, "feedback": "specific guidance on how to fix the code"}

Rules:
- If the result is "SUCCESS", return success:true unless the step clearly could not have worked (e.g. wrong function name)
- If the result starts with "ERROR:", return success:false with targeted fix guidance
- Keep feedback under 120 characters`;

const SUMMARIZER_SYSTEM = `You are a results summarizer for oxDNA viewer. Write a brief 1-3 sentence summary of what was accomplished.

Be friendly, specific about what changed in the molecular structure, and mention any failed steps.
Do not use markdown formatting. Start directly with what was done.`;

// ─────────────────────────────────────────────────────────────
// Core API call — OpenAI-compatible /chat/completions format
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Robust chat-completions fetch: AbortController timeout (default
// ~120s), retry with exponential backoff on 429/5xx/network errors
// (max AGENT_FETCH_MAX_RETRIES retries). Error classes are
// distinguished so chat-visible messages can point at the fix:
//   - TypeError        → CORS/network failure (provider may block
//                        browser CORS; backend-free operation is fine,
//                        this only affects the LLM call itself)
//   - AbortError       → request timed out
//   - 401/403          → bad/rejected API key (points at key fields)
//   - 429/5xx          → retried with backoff, then reported
// Classic script (no bundler): agent-prefixed globals avoid colliding
// with llm_chat.js, which is loaded on the same page.
// ─────────────────────────────────────────────────────────────
const AGENT_FETCH_TIMEOUT_MS = 120000;
const AGENT_FETCH_MAX_RETRIES = 3;
const AGENT_FETCH_BACKOFF_BASE_MS = 1000;

// Stop support: agentChat.stop() sets agentStopRequested and aborts the
// in-flight attempt; run() checks the flag between steps so nothing new
// starts after a stop. Completed steps stay applied (never reverted).
var agentStopRequested = false;
var agentActiveFetchController = null;

function agentFetchIsRetryableStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}

function agentFetchSleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// POSTs a JSON body and resolves with parsed JSON. Throws Errors whose
// messages are safe to show directly in the agent panel. Auth failures
// keep the AUTH_ERROR: prefix and quota failures the QUOTA_ERROR:
// prefix so agentChat.run()'s key-exhaustion hint keeps working.
async function agentChatFetchJson(url, apiKey, body, opts) {
    opts = opts || {};
    var timeoutMs = (opts.timeoutMs != null) ? opts.timeoutMs : AGENT_FETCH_TIMEOUT_MS;
    var maxRetries = (opts.maxRetries != null) ? opts.maxRetries : AGENT_FETCH_MAX_RETRIES;
    var attempt = 0;
    var lastErr = null;
    while (true) {
        if (agentStopRequested) {
            var _agentStopErr = new Error('STOPPED_BY_USER');
            _agentStopErr._agentStopped = true;
            throw _agentStopErr;
        }
        var controller = null;
        var timer = null;
        try {
            if (typeof AbortController !== 'undefined') {
                controller = new AbortController();
                timer = setTimeout(function () { controller.abort(); }, timeoutMs);
            }
            agentActiveFetchController = controller;
            var response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify(body),
                signal: controller ? controller.signal : undefined
            });
            if (timer) clearTimeout(timer);
            agentActiveFetchController = null;
            if (response.ok) {
                return await response.json();
            }
            var errText = '';
            try { errText = await response.text(); } catch (_) {}
            var detail = errText;
            try {
                var parsed = JSON.parse(errText);
                detail = (parsed.error && parsed.error.message) || errText;
            } catch (_) {}
            if (detail && detail.length > 500) detail = detail.substring(0, 500) + '…';
            if (response.status === 401 || response.status === 403) {
                throw new Error('AUTH_ERROR: API key invalid or unauthorized. '
                    + 'Set a valid key with the 🔑 button (stored as oxview_agent_api_key in localStorage) '
                    + 'or agentApiKey/llmApiKey in ts/config.js. (' + (detail || ('HTTP ' + response.status)) + ')');
            }
            lastErr = new Error(response.status === 429
                ? 'QUOTA_ERROR: Rate-limited or quota exhausted' + (detail ? '. (' + detail + ')' : '')
                  + ' — retrying with backoff, then giving up.'
                : 'API error ' + response.status + (detail ? ': ' + detail : ''));
            lastErr._agentRetryable = agentFetchIsRetryableStatus(response.status);
            lastErr._agentStatus = response.status;
        } catch (err) {
            if (timer) clearTimeout(timer);
            agentActiveFetchController = null;
            if (err && err._agentStopped) {
                throw err;
            } else if (err && err.name === 'AbortError') {
                if (agentStopRequested) {
                    var _agentAbortStop = new Error('STOPPED_BY_USER');
                    _agentAbortStop._agentStopped = true;
                    throw _agentAbortStop;
                }
                lastErr = new Error('Request timed out after ' + Math.round(timeoutMs / 1000) + 's — '
                    + 'retrying (attempt ' + (attempt + 1) + '/' + (maxRetries + 1) + ').');
                lastErr._agentRetryable = true;
            } else if (err && !err._agentStatus && (err instanceof TypeError)) {
                // fetch() rejects with TypeError on network failure / CORS block.
                lastErr = new Error('NETWORK_ERROR: could not reach ' + url + '. '
                    + 'The provider may block browser CORS requests, or you may be offline — '
                    + 'retrying with backoff, then giving up. (' + err.message + ')');
                lastErr._agentRetryable = true;
            } else if (!err._agentRetryable && err._agentStatus == null
                    && !/^(AUTH_ERROR|QUOTA_ERROR)/.test(err.message || '')) {
                // Non-HTTP, non-network error (e.g. JSON parse) — not retryable.
                throw err;
            } else if (!err._agentRetryable) {
                throw err;
            } else {
                lastErr = err;
            }
        }
        if (attempt >= maxRetries || !lastErr._agentRetryable) {
            if (/retrying/i.test(lastErr.message)) {
                lastErr.message += ' Gave up after ' + (attempt + 1) + ' attempt' + (attempt === 0 ? '' : 's') + '.';
            }
            throw lastErr;
        }
        await agentFetchSleep(AGENT_FETCH_BACKOFF_BASE_MS * Math.pow(2, attempt));
        attempt++;
    }
}

async function agentApiCall(systemPrompt, userMessage) {
    const key = AGENT_CONFIG.apiKey;
    if (!key) {
        throw new Error('NO_KEY: No API key set. Click the 🔑 button in the Agent AI panel to add your API key.');
    }

    const data = await agentChatFetchJson(`${AGENT_CONFIG.baseURL}/chat/completions`, key, {
        model: AGENT_CONFIG.model,
        max_tokens: 16000,
        temperature: 0.1,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ]
    });

    const choice = data.choices?.[0];
    let text = choice?.message?.content;
    // Thinking models occasionally leave content empty; salvage from reasoning.
    if (!text && choice?.message?.reasoning) text = choice.message.reasoning;
    if (!text) {
        if (choice?.finish_reason === 'length') {
            throw new Error('Model ran out of tokens before answering (finish_reason=length).');
        }
        throw new Error('Empty response from API');
    }
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ─────────────────────────────────────────────────────────────
// Individual agents
// ─────────────────────────────────────────────────────────────
async function agentPlanner(task) {
    const raw = await agentApiCall(PLANNER_SYSTEM, `Task: ${task}`);
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error(`Planner returned non-JSON: ${raw.substring(0, 80)}`);
    return JSON.parse(match[0]);
}

function _sceneBlock() {
    try {
        if (window.space && typeof space.describe === 'function') {
            return `\n\nCURRENT SCENE (live):\n${space.describe()}`;
        }
    } catch (_) {}
    return '';
}

async function agentExecutor(step, retryContext) {
    const userMsg = (retryContext
        ? `Step to execute: ${step}\n\nPrevious attempt failed — fix guidance:\n${retryContext}`
        : `Step to execute: ${step}`) + _sceneBlock();
    const raw = await agentApiCall(EXECUTOR_SYSTEM, userMsg);
    // Strip markdown code fences if the model wrapped them
    const fenceMatch = raw.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
    return fenceMatch ? fenceMatch[1].trim() : raw.trim();
}

async function agentObserver(step, code, execResult) {
    const userMsg = `Step: ${step}\n\nCode:\n${code}\n\nResult: ${execResult}${_sceneBlock()}`;
    const raw = await agentApiCall(OBSERVER_SYSTEM, userMsg);
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (_) {}
    }
    // Fallback: treat exec success as observer success
    return { success: !execResult.startsWith('ERROR'), feedback: raw.substring(0, 100) };
}

async function agentSummarizer(task, stepResults) {
    const stepsText = stepResults
        .map((s, i) => `Step ${i + 1}: "${s.step}" — ${s.success ? 'succeeded' : 'failed'}`)
        .join('\n');
    return await agentApiCall(SUMMARIZER_SYSTEM, `Task: ${task}\n\nOutcomes:\n${stepsText}`);
}

// ─────────────────────────────────────────────────────────────
// Helper: escape HTML for code display
// ─────────────────────────────────────────────────────────────
function agentEscapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────
// Chat threads — browser-localStorage persistence (UI + storage
// only; no backend, no key material stored here).
// Store: oxview_agent_threads = [{id,title,createdAt,updatedAt,
//   messages:[{type,text}]}], active id in
//   oxview_agent_active_thread. Quota-guarded (message/thread
//   caps, oldest-first pruning, prune-and-retry); a corrupt store
//   degrades to an empty list and never breaks the panel.
// Classic script (no bundler): agentThread-prefixed globals avoid
// colliding with llm_chat.js, loaded on the same page.
// ─────────────────────────────────────────────────────────────
const AGENT_THREADS_KEY = 'oxview_agent_threads';
const AGENT_ACTIVE_THREAD_KEY = 'oxview_agent_active_thread';
const AGENT_MAX_THREADS = 20;
const AGENT_MAX_MESSAGES_PER_THREAD = 300;

function agentMakeThreadId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function agentMakeThread(title) {
    var now = Date.now();
    return { id: agentMakeThreadId(), title: title || 'New chat', createdAt: now, updatedAt: now, messages: [] };
}

function agentSanitizeThreads(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    for (var i = 0; i < value.length && out.length < AGENT_MAX_THREADS; i++) {
        var t = value[i];
        if (!t || typeof t.id !== 'string' || !Array.isArray(t.messages)) continue;
        var msgs = [];
        for (var j = 0; j < t.messages.length; j++) {
            var m = t.messages[j];
            if (!m || typeof m.text !== 'string') continue;
            msgs.push({
                type: (typeof m.type === 'string') ? m.type : 'system',
                text: m.text.slice(0, 4000)
            });
        }
        out.push({
            id: t.id,
            title: (typeof t.title === 'string' && t.title.trim()) ? t.title.slice(0, 80) : 'Untitled',
            createdAt: (typeof t.createdAt === 'number') ? t.createdAt : Date.now(),
            updatedAt: (typeof t.updatedAt === 'number') ? t.updatedAt : Date.now(),
            messages: msgs
        });
    }
    return out;
}

function agentLoadThreads() {
    try {
        var raw = localStorage.getItem(AGENT_THREADS_KEY);
        if (!raw) return [];
        return agentSanitizeThreads(JSON.parse(raw));
    } catch (_) {
        return [];
    }
}

function agentPruneThreads(threads) {
    var capped = threads.map(function (t) {
        return {
            id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt,
            messages: t.messages.slice(-AGENT_MAX_MESSAGES_PER_THREAD)
        };
    });
    capped.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return capped.slice(0, AGENT_MAX_THREADS);
}

// Returns true on success, false on quota/corrupt failure. Never throws.
function agentSaveThreads(threads) {
    try {
        localStorage.setItem(AGENT_THREADS_KEY, JSON.stringify(agentPruneThreads(threads)));
        return true;
    } catch (_) {
        try {
            // Quota hit: keep only the newest half and retry once.
            var pruned = agentPruneThreads(threads).slice(0, Math.max(1, Math.floor(AGENT_MAX_THREADS / 2)));
            localStorage.setItem(AGENT_THREADS_KEY, JSON.stringify(pruned));
            return true;
        } catch (_) {
            return false;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Main agentChat object
// ─────────────────────────────────────────────────────────────
const agentChat = {
    isOpen: false,
    isRunning: false,
    threads: [],
    activeThreadId: null,
    threadLog: [],
    _threadsReady: false,

    // Halt the pipeline between steps and abort the in-flight fetch.
    // Safe no-op when idle. Completed steps stay applied (never reverted).
    stop() {
        if (!this.isRunning) return;
        agentStopRequested = true;
        try { if (agentActiveFetchController) agentActiveFetchController.abort(); } catch (_) {}
    },

    _updateStopBtn() {
        var btn = document.getElementById('agent-chat-stop');
        if (btn) btn.disabled = !this.isRunning;
    },

    toggle() {
        const panel = document.getElementById('agent-chat-panel');
        this.isOpen = !this.isOpen;
        panel.style.display = this.isOpen ? 'flex' : 'none';
        if (this.isOpen) {
            document.getElementById('agent-chat-input').focus();
            this._updateKeyStatus();
            this.initModelUI();
            try { this.initThreads(); } catch (_) {}
            try { if (window.space) space.grid(true); } catch (_) {}
        }
    },

    renderImage(dataUrl) {
        if (!dataUrl) return;
        const log = document.getElementById('agent-chat-log');
        if (!log) return;
        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.maxWidth = '100%';
        img.style.borderRadius = '4px';
        img.style.cursor = 'zoom-in';
        img.onclick = () => { const w = window.open(); if (w) w.document.write('<img src="' + dataUrl + '">'); };
        log.appendChild(img);
        log.scrollTop = log.scrollHeight;
    },

    _updateKeyStatus() {
        const el = document.getElementById('agent-key-status');
        if (!el) return;
        const key = AGENT_CONFIG.apiKey;
        el.textContent = key ? `🔑 Key: …${key.slice(-4)}` : '🔑 No key set';
        el.style.color = key ? '#6ee7b7' : '#f87171';
    },

    setApiKey() {
        const current = AGENT_CONFIG.apiKey;
        const input = prompt(
            'Enter your Anthropic API key.\nIt will be saved in localStorage.\nLeave blank to clear.',
            current
        );
        if (input === null) return; // cancelled
        if (input.trim()) {
            localStorage.setItem('oxview_agent_api_key', input.trim());
            this._log('system', '🔑 API key saved.');
        } else {
            localStorage.removeItem('oxview_agent_api_key');
            this._log('system', '🔑 API key cleared.');
        }
        this._updateKeyStatus();
    },

    clearLog() {
        document.getElementById('agent-chat-log').innerHTML = '';
        this.threadLog = [];
        try { this.persistThreads(); } catch (_) {}
        // Marker is display-only, kept out of the saved thread.
        this._renderEntry('system', 'Log cleared. Ready for a new task.');
    },

    // ─────────────────────────────────────────────────────────────
    // Model fetch-and-pick (direct browser fetch, no backend).
    // Persists to 'nc_ai_model' — the same localStorage key
    // AGENT_CONFIG.model already reads. The free-text input stays as
    // the fallback so custom model IDs remain typeable.
    // ─────────────────────────────────────────────────────────────
    initModelUI() {
        try {
            var input = document.getElementById('agent-model-input');
            if (input && !input.value) input.value = AGENT_CONFIG.model;
        } catch (_) {}
    },

    onModelInput(value) {
        try { localStorage.setItem('nc_ai_model', (value || '').trim()); } catch (_) {}
    },

    pickModel(id) {
        if (!id) return;
        try { localStorage.setItem('nc_ai_model', id); } catch (_) {}
        var input = document.getElementById('agent-model-input');
        if (input) input.value = id;
    },

    async refreshModels() {
        var errEl = document.getElementById('agent-models-error');
        var btn = document.getElementById('agent-models-refresh');
        var picker = document.getElementById('agent-model-picker');
        var showErr = function (msg) {
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            agentChat._log('error', msg);
        };
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        if (!AGENT_CONFIG.apiKey) {
            showErr('No API key set — the /models call needs Authorization: Bearer <key>. Set one with the 🔑 button first.');
            return;
        }
        var url = AGENT_CONFIG.baseURL.replace(/\/+$/, '') + '/models';
        if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
        try {
            var response = await fetch(url, {
                headers: { 'Authorization': 'Bearer ' + AGENT_CONFIG.apiKey }
            });
            if (!response.ok) {
                var errText = '';
                try { errText = await response.text(); } catch (_) {}
                var detail = errText;
                try {
                    var parsed = JSON.parse(errText);
                    detail = (parsed.error && parsed.error.message) || errText;
                } catch (_) {}
                if (detail && detail.length > 300) detail = detail.substring(0, 300) + '…';
                if (response.status === 401 || response.status === 403) {
                    throw new Error('🔑 API key rejected (HTTP ' + response.status + '). '
                        + 'Set a valid key with the 🔑 button (stored as oxview_agent_api_key in localStorage).'
                        + (detail ? ' Provider says: ' + detail : ''));
                }
                throw new Error('API error ' + response.status + ' from ' + url + '.'
                    + (detail ? ' ' + detail : ' Check agentBaseURL/llmBaseURL in ts/config.js.'));
            }
            var data = await response.json();
            var ids = [];
            if (data && Array.isArray(data.data)) {
                data.data.forEach(function (m) {
                    if (m && m.id && ids.indexOf(m.id) === -1) ids.push(m.id);
                });
                ids.sort();
            }
            if (ids.length === 0) {
                throw new Error('The /models response contained no data[].id entries — '
                    + 'check agentBaseURL/llmBaseURL in ts/config.js points at an OpenAI-compatible endpoint.');
            }
            if (picker) {
                picker.innerHTML = '';
                var placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'Pick a model… (' + ids.length + ')';
                picker.appendChild(placeholder);
                ids.forEach(function (id) {
                    var opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = id;
                    picker.appendChild(opt);
                });
                var cur = '';
                try { cur = localStorage.getItem('nc_ai_model') || ''; } catch (_) {}
                if (ids.indexOf(cur) !== -1) picker.value = cur;
                picker.style.display = 'block';
            }
            this._log('system', 'Loaded ' + ids.length + ' models from ' + url + '.');
        } catch (err) {
            if (err && (err instanceof TypeError)) {
                // fetch() rejects with TypeError on network failure / CORS block.
                showErr('Network error: could not reach ' + url + '. '
                    + 'The provider may block browser CORS requests, or you may be offline — '
                    + 'check agentBaseURL/llmBaseURL in ts/config.js and that the provider permits CORS from this page. ('
                    + err.message + ')');
            } else {
                showErr('Error: ' + err.message);
            }
            console.error('Agent /models fetch error:', err);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '⟳ Models'; }
        }
    },

    // Display-only DOM builder (no persistence). Used by _log/_logCode
    // and by thread restore, which must not re-persist entries.
    _renderEntry(type, text) {
        const log = document.getElementById('agent-chat-log');
        if (!log) return null;
        var el;
        if (type === 'code') {
            el = document.createElement('div');
            el.className = 'agent-msg agent-msg-code';
            el.innerHTML = `<pre>${agentEscapeHtml(text)}</pre>`;
        } else {
            el = document.createElement('div');
            el.className = `agent-msg agent-msg-${type}`;
            el.textContent = text;
        }
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return el;
    },

    _log(type, text, transient) {
        const el = this._renderEntry(type, text);
        // Transient progress rows ("Planning steps...", "Generating
        // code...") are removed/replaced before the step ends — they
        // are display-only and stay out of the saved thread.
        if (!transient) {
            this.threadLog.push({ type, text: (text || '').slice(0, 4000) });
            if (this.threadLog.length > AGENT_MAX_MESSAGES_PER_THREAD) {
                this.threadLog = this.threadLog.slice(-AGENT_MAX_MESSAGES_PER_THREAD);
            }
            try { this.persistThreads(); } catch (_) {}
        }
        return el;
    },

    _logCode(code) {
        const el = this._renderEntry('code', code);
        this.threadLog.push({ type: 'code', text: (code || '').slice(0, 4000) });
        if (this.threadLog.length > AGENT_MAX_MESSAGES_PER_THREAD) {
            this.threadLog = this.threadLog.slice(-AGENT_MAX_MESSAGES_PER_THREAD);
        }
        try { this.persistThreads(); } catch (_) {}
        return el;
    },

    // ─────────────────────────────────────────────────────────
    // Threads: New / Open / Delete / Rename over the
    // localStorage store above. Autosaved on every logged message
    // via persistThreads(); the active thread is restored on reload.
    // ─────────────────────────────────────────────────────────
    initThreads() {
        try {
            if (this._threadsReady) { try { this.persistThreads(); } catch (_) {} }
            var ts = agentLoadThreads();
            var aid = null;
            try { aid = localStorage.getItem(AGENT_ACTIVE_THREAD_KEY); } catch (_) {}
            var has = function (id) { return ts.some(function (t) { return t.id === id; }); };
            if (!aid || !has(aid)) {
                if (ts.length) {
                    var sorted = ts.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
                    aid = sorted[0].id;
                } else {
                    var t0 = agentMakeThread('Chat 1');
                    ts = [t0];
                    aid = t0.id;
                    agentSaveThreads(ts);
                }
                try { localStorage.setItem(AGENT_ACTIVE_THREAD_KEY, aid); } catch (_) {}
            }
            this.threads = ts;
            this.activeThreadId = aid;
            var active = null;
            ts.forEach(function (t) { if (t.id === aid) active = t; });
            // Adopt saved messages only when this client has nothing
            // newer in memory (e.g. first load / reload).
            if (!this._threadsReady || !this.threadLog.length) {
                this.threadLog = active
                    ? active.messages.map(function (m) { return { type: m.type, text: m.text }; })
                    : [];
            }
            this._threadsReady = true;
            this.renderThreadList();
            this.renderActiveThread();
        } catch (_) {}
    },

    persistThreads() {
        try {
            if (!this.activeThreadId) return false;
            var self = this;
            var firstUser = null;
            this.threadLog.forEach(function (m) {
                if (!firstUser && m && m.type === 'user' && m.text) firstUser = m.text;
            });
            this.threads = this.threads.map(function (t) {
                if (t.id !== self.activeThreadId) return t;
                var title = t.title;
                if (/^(New chat|Chat \d+|Untitled)$/.test(title) && firstUser) {
                    title = firstUser.trim().slice(0, 48) || title;
                }
                return {
                    id: t.id, title: title, createdAt: t.createdAt, updatedAt: Date.now(),
                    messages: self.threadLog.slice(-AGENT_MAX_MESSAGES_PER_THREAD).map(function (m) {
                        return { type: m.type, text: (m.text || '').slice(0, 4000) };
                    })
                };
            });
            try { localStorage.setItem(AGENT_ACTIVE_THREAD_KEY, this.activeThreadId); } catch (_) {}
            return agentSaveThreads(this.threads);
        } catch (_) { return false; }
    },

    renderThreadList() {
        try {
            var sel = document.getElementById('agent-thread-list');
            if (!sel) return;
            var self = this;
            sel.innerHTML = '';
            var ordered = this.threads.slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
            ordered.forEach(function (t) {
                var opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = (t.id === self.activeThreadId ? '● ' : '○ ') + t.title + ' (' + t.messages.length + ')';
                sel.appendChild(opt);
            });
            sel.value = this.activeThreadId || '';
        } catch (_) {}
    },

    renderActiveThread() {
        try {
            var log = document.getElementById('agent-chat-log');
            if (!log || !this.threadLog.length) return;
            log.innerHTML = '';
            var self = this;
            this.threadLog.forEach(function (m) { self._renderEntry(m.type, m.text); });
        } catch (_) {}
    },

    newThread() {
        try {
            this.persistThreads();
            var t = agentMakeThread('Chat ' + (this.threads.length + 1));
            this.threads = agentPruneThreads(this.threads.concat([t]));
            this.activeThreadId = t.id;
            this.threadLog = [];
            this.persistThreads();
            this.renderThreadList();
            var log = document.getElementById('agent-chat-log');
            if (log) {
                log.innerHTML = '';
                this._renderEntry('system', 'New thread started. History is saved in this browser only.');
            }
        } catch (_) {}
    },

    openThread(id) {
        try {
            if (!id || id === this.activeThreadId) return;
            var found = null;
            this.threads.forEach(function (t) { if (t.id === id) found = t; });
            if (!found) return;
            this.persistThreads();
            this.activeThreadId = id;
            this.threadLog = found.messages.map(function (m) { return { type: m.type, text: m.text }; });
            this.persistThreads();
            this.renderThreadList();
            var log = document.getElementById('agent-chat-log');
            if (log) {
                log.innerHTML = '';
                if (this.threadLog.length) {
                    this.renderActiveThread();
                } else {
                    this._renderEntry('system', 'Thread "' + found.title + '" opened — no saved messages yet.');
                }
            }
        } catch (_) {}
    },

    deleteThread() {
        try {
            var id = this.activeThreadId;
            if (!id) return;
            var title = '';
            this.threads.forEach(function (t) { if (t.id === id) title = t.title; });
            if (!confirm('Delete thread "' + title + '" with its saved messages?')) return;
            this.threads = this.threads.filter(function (t) { return t.id !== id; });
            if (!this.threads.length) this.threads = [agentMakeThread('Chat 1')];
            var sorted = this.threads.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
            this.activeThreadId = sorted[0].id;
            var self = this;
            var active = null;
            this.threads.forEach(function (t) { if (t.id === self.activeThreadId) active = t; });
            this.threadLog = active
                ? active.messages.map(function (m) { return { type: m.type, text: m.text }; })
                : [];
            this.persistThreads();
            this.renderThreadList();
            this.renderActiveThread();
        } catch (_) {}
    },

    renameThread() {
        try {
            var id = this.activeThreadId;
            if (!id) return;
            var cur = '';
            this.threads.forEach(function (t) { if (t.id === id) cur = t.title; });
            var name = prompt('Rename thread:', cur);
            if (name === null) return;
            name = (name.trim() || 'Untitled').slice(0, 80);
            this.threads = this.threads.map(function (t) {
                return t.id === id ? { id: t.id, title: name, createdAt: t.createdAt, updatedAt: Date.now(), messages: t.messages } : t;
            });
            agentSaveThreads(this.threads);
            this.renderThreadList();
        } catch (_) {}
    },

    _setStage(stage) {
        // stage: 'planner' | 'executor' | 'observer' | 'summarizer' | null
        ['planner', 'executor', 'observer', 'summarizer'].forEach(s => {
            const el = document.getElementById(`agent-stage-${s}`);
            if (el) el.classList.toggle('active', s === stage);
        });
    },

    handleKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            agentChat.run();
        }
    },

    async run() {
        if (this.isRunning) return;

        const input = document.getElementById('agent-chat-input');
        const sendBtn = document.getElementById('agent-chat-send');
        const task = input.value.trim();
        if (!task) return;

        if (!AGENT_CONFIG.apiKey) {
            this._log('error', '🔑 No API key set. Click the 🔑 button to add your Anthropic API key.');
            return;
        }

        input.value = '';
        input.disabled = true;
        sendBtn.disabled = true;
        this.isRunning = true;
        agentStopRequested = false;
        this._updateStopBtn();

        this._log('user', task);

        try {
            // ── Stage 1: Plan ──────────────────────────────────
            this._setStage('planner');
            const planningEl = this._log('planner', '🗂 Planning steps...', true);

            let steps;
            try {
                steps = await agentPlanner(task);
            } catch (e) {
                planningEl.textContent = `🗂 Planning failed: ${e.message}`;
                planningEl.className = 'agent-msg agent-msg-error';
                throw e;
            }

            planningEl.remove();
            this._log('planner', `📋 Plan — ${steps.length} step${steps.length !== 1 ? 's' : ''}:`);
            steps.forEach((s, i) => this._log('planner-step', `  ${i + 1}. ${s}`));

            const stepResults = [];

            // ── Stage 2 & 3: Execute + Observe each step ───────
            for (let i = 0; i < steps.length; i++) {
                if (agentStopRequested) break;
                const step = steps[i];
                this._log('divider', `── Step ${i + 1} / ${steps.length} ──────────────────────`);
                this._log('system', `▶ ${step}`);

                let success = false;
                let lastCode = '';
                let retryContext = '';

                for (let attempt = 0; attempt < AGENT_MAX_RETRIES; attempt++) {
                    if (agentStopRequested) break;
                    // Execute
                    this._setStage('executor');
                    const attemptSuffix = attempt > 0 ? ` (retry ${attempt}/${AGENT_MAX_RETRIES - 1})` : '';
                    const execEl = this._log('executor', `⚙️ Generating code${attemptSuffix}...`, true);

                    try {
                        lastCode = await agentExecutor(step, attempt > 0 ? retryContext : '');
                    } catch (e) {
                        execEl.textContent = `⚙️ Code generation error: ${e.message}`;
                        execEl.className = 'agent-msg agent-msg-error';
                        throw e;
                    }
                    execEl.remove();
                    this._logCode(lastCode);

                    // Run the code
                    let execResult = 'SUCCESS';
                    try {
                        (new Function(lastCode))();
                        if (typeof render === 'function') render();
                    } catch (execErr) {
                        execResult = `ERROR: ${execErr.message}`;
                        this._log('error', `⚠ Exec error: ${execErr.message}`);
                        console.error('Agent exec error:', execErr, '\nCode:', lastCode);
                    }

                    // Observe
                    this._setStage('observer');
                    const obsEl = this._log('observer', '🔍 Verifying result...', true);

                    let observation;
                    try {
                        observation = await agentObserver(step, lastCode, execResult);
                    } catch (_) {
                        // If observer itself fails, fall back to exec result
                        observation = { success: execResult === 'SUCCESS', feedback: 'Verification unavailable' };
                    }

                    if (observation.success) {
                        obsEl.textContent = '✅ Step verified';
                        obsEl.className = 'agent-msg agent-msg-success';
                        success = true;
                        break;
                    } else {
                        obsEl.textContent = `⚠ ${observation.feedback}`;
                        obsEl.className = 'agent-msg agent-msg-warning';
                        retryContext = observation.feedback;
                        if (attempt === AGENT_MAX_RETRIES - 1) {
                            this._log('error', `✗ Step ${i + 1} failed after ${AGENT_MAX_RETRIES} attempts.`);
                        }
                    }
                }

                if (agentStopRequested) break;
                stepResults.push({ step, success, code: lastCode });
            }

            // ── Stage 4: Summarize ──────────────────────────────
            if (agentStopRequested) {
                const doneCount = stepResults.filter(s => s.success).length;
                this._log('system', `⏹ Stopped — ${doneCount}/${steps.length} steps completed; completed steps kept.`);
            } else {
                this._setStage('summarizer');
                const sumEl = this._log('summarizer', '📝 Summarizing...', true);

                try {
                    const summary = await agentSummarizer(task, stepResults);
                    sumEl.remove();
                    this._log('summary', '📝 ' + summary);
                } catch (e) {
                    sumEl.textContent = `📝 Summary error: ${e.message}`;
                    sumEl.className = 'agent-msg agent-msg-error';
                }
            }

        } catch (err) {
            if (err && (err.message === 'STOPPED_BY_USER' || err._agentStopped)) {
                this._log('system', '⏹ Stopped — completed steps kept, nothing new started.');
            } else {
                this._log('error', `❌ ${err.message}`);
                console.error('Agent pipeline error:', err);

                if (err.message.includes('QUOTA_ERROR') || err.message.includes('AUTH_ERROR')) {
                    this._log('error', '⚠ Your API key may be exhausted or invalid. Check your Anthropic account at console.anthropic.com.');
                }
            }
        } finally {
            this._setStage(null);
            this.isRunning = false;
            agentStopRequested = false;
            agentActiveFetchController = null;
            input.disabled = false;
            sendBtn.disabled = false;
            this._updateStopBtn();
            input.focus();
        }
    }
};

try { window.agentChat = agentChat; } catch (e) {}
try { agentChat.initModelUI(); } catch (e) {}
try { agentChat.initThreads(); } catch (e) {}
