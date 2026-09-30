/**
 * LLM Chat interface for oxDNA viewer
 * Uses nano-gpt.com API (OpenAI-compatible) to translate natural language to viewer API calls
 */

const LLM_CONFIG = {
    // NanoCanvas parity: the same nano-gpt endpoint/model defaults, and the
    // same browser-localStorage keys NanoCanvas's LLMPanel uses (nc_ai_*),
    // so a key saved in either tool works in the other. Precedence:
    // oxView key → OXVIEW_CONFIG/tsconfig → NanoCanvas key → '' (chat shows fix hint).
    get baseURL() {
        return (window.OXVIEW_CONFIG || {}).llmBaseURL
            || localStorage.getItem('nc_ai_url')
            || "https://nano-gpt.com/api/v1";
    },
    get model() {
        return (window.OXVIEW_CONFIG || {}).llmModel
            || localStorage.getItem('nc_ai_model')
            || "z-ai/glm-5.3:thinking";
    },
    // Key comes from ts/config.js (gitignored), the 🔑 button (localStorage), or web-config.js.
    get apiKey()  {
        return localStorage.getItem('oxview_llm_api_key')
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
}

const SYSTEM_PROMPT = `You are an AI assistant for oxDNA viewer (oxView), a 3D molecular visualization and editing tool for DNA/RNA nanostructures.

Convert natural language commands into JavaScript code that runs directly in the viewer. Respond with ONLY valid JavaScript — no explanations, no markdown, no code blocks. Always end with render(); to update the viewport.

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
clusterCounter   : number           — incremented when a new cluster is created
tmpSystems       : System[]         — scratch systems used during editing
forceHandler     : ForceHandler     — external force manager

════════════════════════════════════════
api.* — SCENE & VISUALIZATION
════════════════════════════════════════
api.getElements(ids: number[])                        → BasicElement[]
    Get elements by their numeric IDs.
    Example: api.getElements([0, 1, 2])

api.selectElementIDs(ids: number[], keepPrev?: bool)  → void
    Select elements by ID. keepPrev=true adds to selection.

api.selectElements(elems: BasicElement[], keepPrev?)  → void
    Select an array of elements.

api.selectPDBIDs(nums: number[], chains?: string[], keepPrev?) → void
    Select by PDB residue number and optional chain IDs.

api.findElement(element: BasicElement, steps?: number) → void
    Animate camera to fly to an element.

api.highlight5ps(system?: System)                     → void
    Color-highlight all 5' ends in a system.

api.highlight3ps(system?: System)                     → void
    Color-highlight all 3' ends in a system.

api.update3primeMarkers(diameter, length, spacing)    → void
    Resize the cone markers drawn at 3' ends.

api.toggleStrand(strand: Strand)                      → Strand
    Toggle visibility of one strand.

api.toggleElements(elems: BasicElement[])             → void
    Toggle visibility of an array of elements.

api.toggleAll(system?: System)                        → void
    Toggle visibility of every element in a system.

api.toggleBaseColors()                                → void
    Switch nucleoside colours between element colour and grey.

api.countStrandLength(system?: System)                → {[len]: Strand[]}
    Returns a dict mapping strand length → array of strands.

api.trace53(element: BasicElement)                    → BasicElement[]
    Walk 5'→3' from element; returns ordered array.

api.trace35(element: BasicElement)                    → BasicElement[]
    Walk 3'→5' from element; returns ordered array.

api.switchCamera()                                    → void
    Toggle between Perspective and Orthographic camera.

api.setBackgroundColor(color: string)                 → void
    Set canvas background. color is a CSS string, e.g. '#000000'.

api.showColorbar()                                    → void
    Display the colorbar overlay.

api.removeColorbar()                                  → void
    Hide the colorbar overlay.

api.changeColormap(name: string)                      → void
    Switch colormap. Names: 'rainbow','cooltowarm','viridis','plasma',
    'inferno','magma','cividis','grayscale','blackbody', etc.

api.setColorBounds(min: number, max: number)          → void
    Set the numeric range mapped to the colormap.

api.showEverything()                                  → void
    Make all elements visible and restore default scale.

════════════════════════════════════════
edit.* — STRUCTURE EDITING
════════════════════════════════════════
edit.createStrand(sequence, createDuplex?, isRNA?)    → BasicElement[]
    Create a new strand. sequence is a base string (A/T/G/C/U).
    createDuplex=true builds the complementary strand too.
    isRNA=true uses RNA nucleotides.
    Returns addedElems[]:
      [0]  = first nucleotide of the top (sense) strand
      [1]  = first nucleotide of the bottom (antisense) strand — its base-pair partner
      [2..n]   = remaining top strand nucleotides
      [n+1..]  = remaining bottom strand nucleotides
    To get strands from return value: elems[0].strand (top), elems[1].strand (bottom).
    NEVER use elems[0].pair.strand — .pair can be null if a second strand is placed on top
    of an existing one (findPair finds a cross-duplex match and skips createBP).

    CRITICAL — when calling createStrand more than once:
    Translate the FIRST strand away immediately before calling createStrand again.
    Both calls place the strand at the same camera position; overlap causes findPair() to
    incorrectly match nucleotides across duplexes and leaves .pair undefined.
      var d1 = edit.createStrand(seq, true);
      translateElements(new Set(d1.filter(Boolean)), new THREE.Vector3(10, 0, 0));
      var d2 = edit.createStrand(seq, true);  // now safe — no overlap

    Examples:
      edit.createStrand('ATCGATCGATCGATCGATCG', true);   // 20-bp DNA duplex
      edit.createStrand('AAAGGGCCC', true, true);        // RNA duplex

edit.extendStrand(end: BasicElement, sequence)        → BasicElement[]
    Extend a single strand from its end nucleotide.

edit.extendDuplex(end: Nucleotide, sequence)          → BasicElement[]
    Physically extend a duplex from a terminal nucleotide, growing the helix geometry.
    Pass the terminal nucleotide (strand.end3 or strand.end5). Automatically extends both strands.
    Use this — not ligate — when you want to make a longer physically valid duplex.
    Example: edit.extendDuplex(systems[0].strands[0].end3, 'AAAGGG');

edit.deleteElements(victims: BasicElement[])          → void
    Permanently delete elements.
    Example: edit.deleteElements(api.getElements([5, 6, 7]));
    To delete by colour: each element has a .color property (THREE.Color or undefined).
    Example — delete all blue elements:
      var toDelete = [];
      systems.forEach(function(sys){ sys.getMonomers().forEach(function(e){
        var c = e.color; if (c && c.b > 0.6 && c.r < 0.4) toDelete.push(e);
      }); });
      edit.deleteElements(toDelete); render();

edit.nick(element: BasicElement)                      → void
    Cut the phosphodiester bond before element (nick).
    Example: edit.nick(api.getElements([10])[0]);

edit.ligate(a: BasicElement, b: BasicElement)         → void
    Join the 3' of a to the 5' of b.
    IMPORTANT: purely topological — does NOT move or reposition atoms.
    Only use when the two ends are already physically adjacent and correctly oriented.
    For growing a duplex end-to-end, use edit.extendDuplex instead.

edit.skip(elems: BasicElement[])                      → void
    Delete elements and auto-ligate their neighbours.

edit.insert(e: BasicElement, sequence)                → BasicElement[]
    Insert bases after element e.

edit.getSequence(elems: Set<BasicElement>)            → string
    Return the sequence string of a set of elements.

edit.setSequence(elems: Set<BasicElement>, seq, setComplementary?) → void
    Mutate the bases of elements to match seq.

edit.createBP(elem: Nucleotide, undoable?)            → Nucleotide
    Create a complementary base-pair partner for elem.

edit.interconnectDuplex3p(strand1, strand2, patchSeq?) → void
    Bridge the 3' ends of two strands with a short duplex.
    Default patch sequence: 'GGGGGGGGG'

edit.interconnectDuplex5p(strand1, strand2, patchSeq?) → void
    Bridge the 5' ends of two strands with a short duplex.

edit.addElementsAt(copies: InstanceCopy[], pos?)      → BasicElement[]
    Paste copied elements at an optional position.

edit.addElements(copies: InstanceCopy[])              → BasicElement[]
    Paste copied elements at their original positions.

edit.move_to(target: BasicElement, toDisplace: BasicElement[]) → void
    Move a list of elements so their first element lands on target.

════════════════════════════════════════
GLOBAL TRANSFORM FUNCTIONS (not namespaced)
════════════════════════════════════════
translateElements(elements: Set<BasicElement>, v: THREE.Vector3) → void
    Move elements by displacement vector v.

rotateElements(elements, axis: THREE.Vector3, angle: number, about: THREE.Vector3) → void
    Rotate elements around axis (radians) about a pivot point.

rotateElementsByQuaternion(elements, q: THREE.Quaternion, about?) → void
    Rotate elements using a quaternion.

════════════════════════════════════════
SYSTEM & ELEMENT METHODS
════════════════════════════════════════
system.getMonomers()             → BasicElement[]   all nucleotides in system
system.strands                   : Strand[]         all strands
system.callAllUpdates()          → void             refresh instance arrays

strand.getMonomers()             → BasicElement[]   nucleotides in strand
strand.end5 / strand.end3        : BasicElement     5' and 3' terminal elements

element.getPos()                 → THREE.Vector3    element center-of-mass position
element.strand                   : Strand           parent strand
element.pair                     : Nucleotide|null  base-paired partner
element.n3 / element.n5          : BasicElement     3' / 5' neighbour
element.id                       : number           global element ID
element.sid                      : number           system-local element ID
element.clusterId                : number           cluster assignment
element.isPaired()               → bool             true if has a base pair
element.changeType(base: string) → void             mutate to A/T/G/C/U

════════════════════════════════════════
OBSERVABLES (api.observable)
════════════════════════════════════════
new api.observable.CMS(elements, size, color)
    Sphere that tracks the center of mass of elements.
    .calculate() — update position

new api.observable.Track(particle)
    Line that draws the displacement history of a mesh.
    .calculate() — append new point

new api.observable.MeanOrientation(bases, len?, color?)
    Arrow showing mean base-vector orientation.
    .update() — recalculate direction

════════════════════════════════════════
UI HELPERS (global functions)
════════════════════════════════════════
notify(message, type?, keepOpen?, title?)   — toast notification
    type: 'success'|'warning'|'alert'|'info' (default 'info')
    Example: notify('Done!', 'success');

ask(title, content, onYes?, onNo?)          — confirmation dialog

colorElements(color?, elems?)               — colour elements
    IMPORTANT: elems is a BasicElement[] (not a Set). If omitted, uses Array.from(selectedBases).
    If selectedBases is empty and elems is not given, shows a warning and colours NOTHING.
    colorElements() also calls clearSelection() after colouring — selectedBases will be empty afterwards.
    ALWAYS pass elems explicitly. Never rely on implicit selection state.
    color: THREE.Color
    Examples:
      colorElements(new THREE.Color(1,0,0), Array.from(selectedBases)); // colour current selection
      colorElements(new THREE.Color(1,0,0), systems[0].getMonomers());  // colour all in system 0
      colorElements(new THREE.Color(0,0,1), api.getElements([0,1,2])); // colour by ID

updateColoring(mode?)                       — refresh colours
    modes: 'Overlay','Strand','Custom','Position','Base','Index','Cluster'

resetCustomColoring()                       — reset to Strand mode

view.toggleWindow(id, oncreate?)            — open/close a named panel
view.saveCanvasImage(scaleFactor?)          — download canvas as PNG
view.longCalculation(calc, msg, callback?)  — run heavy task with progress msg
view.scaleComponent(name, factor)           — scale a geometry component
    names: 'backbone','nucleoside','connector','bbconnector'

resetScene(resetCamera?)                    — wipe all systems and start fresh
findBasepairs(minLen?)                      — detect and pair complementary bases

editHistory.undo()                          — undo the last revertable edit
editHistory.redo()                          — redo the last undone edit
    Use for any "undo"/"redo" request. Always call render() after.
    Example: editHistory.undo(); render();

════════════════════════════════════════
CRITICAL RULES
════════════════════════════════════════
0. EXECUTION SCOPE: Each code block runs inside its own new Function() — variables from previous
   code blocks (d1, d2, seq, etc.) DO NOT EXIST in a new block.
   To reference previously created structures, use global state only:
     systems[]            — all systems; systems[0].getMonomers() for all elements
     clusterId            — stamped on every element at creation; use to identify prior strands
   Pattern to re-acquire the two most recently created clusters:
     var allMonomers = [];
     systems.forEach(function(sys){ allMonomers = allMonomers.concat(sys.getMonomers()); });
     var clusterIds = Array.from(new Set(allMonomers.map(function(e){ return e.clusterId; }))).sort(function(a,b){ return a-b; });
     var c1elems = allMonomers.filter(function(e){ return e.clusterId === clusterIds[clusterIds.length-2]; });
     var c2elems = allMonomers.filter(function(e){ return e.clusterId === clusterIds[clusterIds.length-1]; });

1. colorElements() REQUIRES elems to be passed explicitly.
   WRONG:  colorElements(new THREE.Color(1,0,0));
   RIGHT:  colorElements(new THREE.Color(1,0,0), Array.from(selectedBases));
   RIGHT:  colorElements(new THREE.Color(1,0,0), systems[0].getMonomers());

2. When the user says "selected", "current", or "highlighted" elements:
   - Capture selectedBases BEFORE any colorElements call (it clears selection afterwards).
   - Guard against empty selection:
     var targets = Array.from(selectedBases);
     if (targets.length === 0) { notify("No elements selected", "warning"); } else { colorElements(color, targets); render(); }

3. edit.deleteElements, edit.getSequence, edit.setSequence operate on selectedBases or an explicit set.
   When the user references "selected" elements, pass selectedBases (a Set) directly:
     edit.deleteElements([...selectedBases]);
     edit.getSequence(selectedBases);

4. api.selectElements() and api.selectElementIDs() internally call render() — no extra render() needed after them unless you also modify geometry.

5. To delete elements by colour (e.g. "remove the blue duplex"), use element.color (THREE.Color):
   WRONG: guessing by clusterId — cluster IDs do not correspond to visual colour.
   RIGHT: filter by element.color channel values:
     var toDelete = [];
     systems.forEach(function(sys){ sys.getMonomers().forEach(function(e){
       var c = e.color;
       if (c && c.b > 0.6 && c.r < 0.4) toDelete.push(e); // blue
     }); });
     edit.deleteElements(toDelete); render();
   Thresholds for common colours:
     red:    c.r > 0.6 && c.g < 0.4 && c.b < 0.4
     green:  c.g > 0.6 && c.r < 0.4 && c.b < 0.4
     blue:   c.b > 0.6 && c.r < 0.4
     yellow: c.r > 0.7 && c.g > 0.5 && c.b < 0.3

════════════════════════════════════════
COMMON PATTERNS
════════════════════════════════════════

// Move all elements of systems[0] to absolute position (x, y, z):
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
translateElements(new Set(monomers), new THREE.Vector3(X, Y, Z).sub(com));
render();

// Rotate all elements of systems[0] by 45° around Z-axis at their COM:
var monomers = systems[0].getMonomers();
var com = new THREE.Vector3();
monomers.forEach(function(e){ com.add(e.getPos()); });
com.divideScalar(monomers.length);
rotateElements(new Set(monomers), new THREE.Vector3(0,0,1), Math.PI/4, com);
render();

// Color the currently selected elements red (guard against empty selection):
var targets = Array.from(selectedBases);
if (targets.length === 0) {
    notify('No elements selected — select elements first', 'warning');
} else {
    colorElements(new THREE.Color(1, 0, 0), targets);
    render();
}

// Color ALL elements in system 0 blue (no prior selection needed):
colorElements(new THREE.Color(0, 0, 1), systems[0].getMonomers());
render();

// Select strand of element 5, then colour it red:
var strandElems = api.getElements([5])[0].strand.getMonomers();
colorElements(new THREE.Color(1, 0, 0), strandElems);
render();

// Delete selected elements:
edit.deleteElements([...selectedBases]);
render();

// OXDNA UNIT REFERENCE: 1 oxDNA unit ≈ 0.85 nm.
//   DNA duplex diameter ≈ 2.0 nm ≈ 2.35 oxDNA units.
//   Minimum gap between parallel duplexes ≈ 0.5 oxDNA units.
//   So adjacent parallel duplexes: centre-to-centre spacing ≈ 2.5–3.0 oxDNA units.
//   NEVER use ±10 or larger for "next to each other" — that is ~8.5 nm, far apart.

// Create two 20-bp duplexes side by side (parallel, ~3 units apart):
var seq = 'ATCGATCGATCGATCGATCG';
var d1 = edit.createStrand(seq, true);
// Move d1 to origin first
var com1 = new THREE.Vector3();
d1.filter(Boolean).forEach(function(e){ com1.add(e.getPos()); });
com1.divideScalar(d1.filter(Boolean).length);
translateElements(new Set(d1.filter(Boolean)), com1.clone().negate());
// Create d2 far away to avoid overlap during creation, then move it adjacent
var d2 = edit.createStrand(seq, true);
var com2 = new THREE.Vector3();
d2.filter(Boolean).forEach(function(e){ com2.add(e.getPos()); });
com2.divideScalar(d2.filter(Boolean).length);
translateElements(new Set(d2.filter(Boolean)), new THREE.Vector3(3, 0, 0).sub(com2));
render();

// Create a 20-bp DNA duplex:
edit.createStrand('ATCGATCGATCGATCGATCG', true);
render();

// Create a 15-bp RNA duplex:
edit.createStrand('AUGCAUGCAUGCAUG', true, true);
render();

// Extend duplex from element 0 with 5 more bases:
edit.extendDuplex(api.getElements([0])[0], 'AAAAA');
render();

// Nick at element 10:
edit.nick(api.getElements([10])[0]);
render();

// Ligate element 3 (3') to element 7 (5'):
edit.ligate(api.getElements([3])[0], api.getElements([7])[0]);
render();

// Create a Holliday junction (X-shaped four-way DNA junction):
// Two 20-bp duplexes nicked and cross-ligated at their midpoints.
var seq = 'ATCGATCGATCGATCGATCG';
var d1 = edit.createStrand(seq, true);
// Immediately move duplex 1 away so duplex 2 is placed without overlap
translateElements(new Set(d1.filter(Boolean)), new THREE.Vector3(0, 10, 0));
var d2 = edit.createStrand(seq, true);
// Access strands via index (NOT .pair.strand — .pair can be null when overlap occurs)
var s0 = d1[0].strand;   // top strand duplex 1
var s1 = d1[1].strand;   // bottom strand duplex 1
var s2 = d2[0].strand;   // top strand duplex 2
var s3 = d2[1].strand;   // bottom strand duplex 2
// Position duplex 2 parallel and adjacent to duplex 1 at the crossover point
var d2elems = d2.filter(Boolean);
var com1 = new THREE.Vector3(), com2 = new THREE.Vector3();
d1.filter(Boolean).forEach(function(e){ com1.add(e.getPos()); });
com1.divideScalar(d1.filter(Boolean).length);
d2elems.forEach(function(e){ com2.add(e.getPos()); });
com2.divideScalar(d2elems.length);
translateElements(new Set(d2elems), new THREE.Vector3(2.3, 0, 0).add(com1).sub(com2));
// nick(element) cuts the bond between element and element.n3:
//   → element.n3 = null  (element becomes 3' terminal of first half)
//   → element.n3_old.n5 = null  (next element becomes 5' terminal of second half)
// So nick(s0m[9]) → fragment1=[0..9], fragment2=[10..19]
// ligate(s0m[9], s2m[10]) then works: s0m[9].n3=null and s2m[10].n5=null ✓
var s0m = s0.getMonomers(), s1m = s1.getMonomers();
var s2m = s2.getMonomers(), s3m = s3.getMonomers();
edit.nick(s0m[9]); edit.nick(s1m[9]);
edit.nick(s2m[9]); edit.nick(s3m[9]);
// Cross-ligate: strand 0 first-half → strand 2 second-half, and vice versa
edit.ligate(s0m[9], s2m[10]); edit.ligate(s2m[9], s0m[10]);
edit.ligate(s1m[9], s3m[10]); edit.ligate(s3m[9], s1m[10]);
// Colour the 4 resulting strands distinctly (ligate updates element.strand pointers)
var strandA = s0m[0].strand;  // s0[0..9] + s2[10..19]
var strandB = s2m[0].strand;  // s2[0..9] + s0[10..19]
var strandC = s1m[0].strand;  // s1[0..9] + s3[10..19]
var strandD = s3m[0].strand;  // s3[0..9] + s1[10..19]
colorElements(new THREE.Color(0.9,0.1,0.1), strandA.getMonomers());
colorElements(new THREE.Color(0.1,0.5,0.9), strandB.getMonomers());
colorElements(new THREE.Color(0.1,0.8,0.1), strandC.getMonomers());
colorElements(new THREE.Color(0.9,0.7,0.1), strandD.getMonomers());
notify('Holliday junction created', 'success');
render();

// Extend an existing duplex end-to-end (PREFERRED over creating a second duplex and ligating):
// extendDuplex physically grows the helix — always geometrically valid.
// Pass the terminal nucleotide of the strand you want to extend FROM.
var elems = edit.createStrand('ATCGATCGATCGATC', true);
edit.extendDuplex(elems[0].strand.end3, 'GCTAGCTAGCTAGCT');
render();

// Ligate two ALREADY-ADJACENT duplexes end-to-end using clusterId (robust, no strand index assumptions):
// IMPORTANT: edit.ligate is purely topological — it does NOT move atoms.
// Only call it when the two ends are already physically close and correctly oriented.
// Use extendDuplex instead if you want one geometrically valid continuous duplex.
var allMonomers = [];
systems.forEach(function(sys){ allMonomers = allMonomers.concat(sys.getMonomers()); });
var clusterIds = Array.from(new Set(allMonomers.map(function(e){ return e.clusterId; }))).sort(function(a,b){ return a-b; });
var c1 = clusterIds[clusterIds.length-2];  // second-to-last created cluster
var c2 = clusterIds[clusterIds.length-1];  // last created cluster
var allStrands = [];
systems.forEach(function(sys){ allStrands = allStrands.concat(sys.strands); });
var s1 = allStrands.filter(function(s){ return s.getMonomers().some(function(e){ return e.clusterId===c1; }); });
var s2 = allStrands.filter(function(s){ return s.getMonomers().some(function(e){ return e.clusterId===c2; }); });
edit.ligate(s1[0].end3, s2[0].end5);
edit.ligate(s2[1].end3, s1[1].end5);
render();

// Get sequence of selected bases:
var seq = edit.getSequence(selectedBases);
notify('Sequence: ' + seq);

// Set sequence of selected bases:
edit.setSequence(selectedBases, 'ATCGATCG');
render();

// Switch camera:
api.switchCamera();

// Change colormap to viridis:
api.changeColormap('viridis');
render();

// Set background to black:
api.setBackgroundColor('#000000');

// Toggle visibility of all in system 0:
api.toggleAll(systems[0]);
render();

// Show notification:
notify('Hello from AI!', 'success');

════════════════════════════════════════
shapes.* — DRAW DNA/RNA ALONG GEOMETRIC SHAPES  (prefer these over hand-rolling from edit.createStrand)
════════════════════════════════════════
Every shapes.* call places nucleotides at geometric positions, auto-tags the result
via llmTracker (so space.* can address it by name later), and returns BasicElement[].
Positions are in oxDNA units (1 unit ≈ 0.85 nm). normal is the plane normal.

shapes.line(p1, p2, nBases, seq?, isRNA?, tag?)
shapes.circle(center, normal, radius, nBases, seq?, isRNA?, tag?)
shapes.polygon(nSides, center, normal, radius, basesPerSide, seq?, isRNA?, tag?)
shapes.triangle(center, normal, sideLen, basesPerSide, seq?, isRNA?, tag?)
shapes.square(center, normal, sideLen, basesPerSide, seq?, isRNA?, tag?)
shapes.star(center, normal, outerR, innerR, numPoints, basesPerEdge, seq?, isRNA?, tag?)
shapes.cube(center, sideLen, basesPerEdge, seq?, isRNA?, tag?)
shapes.tetrahedron(center, sideLen, basesPerEdge, seq?, isRNA?, tag?)
shapes.sphere(center, radius, nBases, seq?, isRNA?, tag?)
shapes.helix(center, axis, radius, risePerBase, turns, nBases, seq?, isRNA?, tag?)
shapes.spiral(center, normal, startR, endR, turns, nBases, seq?, isRNA?, tag?)
shapes.pointCloud(points: THREE.Vector3[], seq?, isRNA?, tag?)
shapes.basesForLength(len, spacing?=1) → recommended base count
Duplex builders (real B-DNA duplexes, auto-ligated at vertices — prefer for DNA design):
shapes.duplexEdge(p0, p1, seq?, isRNA?, tag?)
shapes.outline(points, {closed?, seq?, isRNA?, tag?, ligate?, threshold?}) → elems (.edges/.ligated/.pairs)
shapes.triangleDuplex(center, normal, sideLen, seq?, isRNA?, tag?)
shapes.triLattice(nx, ny, sideLen, center?, normal?) → pure geometry {verts, edges, cells}
shapes.triangleCrystal(center, normal, sideLen, nx, ny, nz, {tag?, seq?, isRNA?, layerGap?, twistDeg?, shift?, threshold?})

// A 3D star with 5 points in the XY plane, named 'star1':
shapes.star(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 10, 4, 5, 6, null, false, 'star1');
render();

════════════════════════════════════════
space.* — SPATIAL AWARENESS & OBJECT-ADDRESSED TRANSFORMS
════════════════════════════════════════
Objects are named groups (from a shapes.* tag, llmTracker.tag/alias, a clusterId
number or 'cluster7' string, 'selection', or 'system0'/'system1'…). space.* survives the per-block scope reset
because names are global — ALWAYS move/rotate by name, never by re-capturing arrays.
A labelled 3-D reference grid exists (Red=X, Green=Y, Blue=Z; 1 cell = 3 units ≈
one duplex diameter ≈ 2.5 nm; tick sprites read X:+15 etc.). It auto-shows when the
chat opens; toggle any time with space.grid().

space.describe()                         → text digest of every object (also auto-shown each turn)
space.digest()                           → structured {objects:[{name,kind,count,centroid,bbox,size,axis,color}], box, grid}
space.list()                             → [names]
space.info(name)                         → full live record (name,kind,count,centroid,bbox,size,axis,color,members?) | null
space.get(name)                          → BasicElement[]
space.centroid(name) / space.bbox(name) / space.size(name) / space.axis(name)
space.moveTo(name, x, y, z)              → put object's centroid at (x,y,z)
space.moveBy(name, dx, dy, dz)
space.rotate(name, axis, deg, pivot?)    → axis: [x,y,z] or 'x'|'y'|'z'; pivot: undefined(centroid) | 'origin' | [x,y,z] | otherName
space.align(name, worldDir)              → rotate so the object's principal axis points along worldDir ('x'|'y'|'z'|…)
space.place(name, {near, dir, gap})      → move so its bbox sits 'gap' units from object 'near' along dir ([x,y,z] or 'x'|'-x')
space.snapToGrid(name, cell?=3)          → snap centroid to the reference lattice
space.duplicate(name, {offset?, newName?}) → copy via InstanceCopy, translate, tag copy
space.rename(old, new) / space.deleteObject(name)
space.select(name, keepPrev?)            → select region (user sees highlight)
space.focus(name)                        → select + fly camera there (user inspects region)
space.frameAll()                         → fit whole scene in view
space.listClusters()                     → [{id,label,size}] ALL native clusters (DBSCAN/rigidDNA/manual), not just tags
space.selectCluster(id, keepPrev?) / space.nameCluster(id, name) / space.clusterSelection(name?) → selection→cluster, returns id
space.autoClusterRigidDna()              → async helix-geometry clustering (rigidDNA window section 1, headless)
space.relaxRigidDna({steps?,dt?,k?,b?,repulsion?,...}) → async rigidDNA relax + apply to scene (headless, single run)
space.distance(a, b) / space.gap(a, b)   → centroid distance / min bbox gap (negative = overlapping)
space.overlaps(a, b)                     → bool
space.angleBetween(a, b)                 → degrees between principal axes
space.findNicks(threshold?=1.0)          → [{aId,bId,dist}] 5'/3' end pairs (query only)
space.ligateNearby(threshold?=1.5)        → {ligated, pairs} auto-connect nearby ends
space.countAll() / space.exportScene()   → {objects,totalNucleotides,totalStrands} / JSON digest string
space.snapshotImage(scale?)             → PNG dataURL of the viewport
space.show(name?)                        → focus (if named) + snapshot + display it in this chat
space.grid(on?) / space.toggleGrid()     → reference grid + XYZ axes

// Build two stars and stand them side by side, 3 units apart, then show it:
shapes.star(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 10, 4, 5, 6, null, false, 'starA');
shapes.star(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 10, 4, 6, 6, null, false, 'starB');
space.place('starB', {near:'starA', dir:'x', gap:3});
space.rotate('starB', 'y', 90);
space.show();

════════════════════════════════════════
llmTracker.* — STRUCTURE REGISTRY (name, direction, position per cluster)
════════════════════════════════════════
Every shapes.* tag lands here. Entries carry kind ('shape'|'duplex'|'edge'|
'wireframe'|'copy'|'group'), live centroid/bbox/size, principal direction,
colour, provenance and timestamps. Group aliases (e.g. a whole crystal) resolve
to the union of their members without re-clustering. The user browses the same
data in the "Ledger" ribbon window (view.toggleWindow('structureLedgerWindow')):
each row shows name/kind/count/position/size/direction with Select + Inspect.

llmTracker.tag(elems, name?, color?, kind?) → clusterId
llmTracker.alias(name, [memberNames])       → group existing names (crystal = layers = cells = edges)
llmTracker.resolve(name) / getByName(name)  → BasicElement[] (alias-aware, live)
llmTracker.getByClusterId(cid) / getAll()
llmTracker.list()                           → [{name, clusterId, size, kind}]
llmTracker.listDetailed()                   → full live spatial records (what the Ledger shows)
llmTracker.info(name) / describe()          → one record | null / multi-line text
llmTracker.selectByName(name, keepPrev?) / llmTracker.focus(name)
llmTracker.colorByName(name, color) / llmTracker.rename(old, new)
llmTracker.deleteByName(name)               → alias name removes alias only; entry removes elements
llmTracker.clear() / status()

════════════════════════════════════════
shapes.* — DUPLEX OUTLINES & CRYSTALS (real B-DNA, auto-connected)
════════════════════════════════════════
Single-strand sketch shapes (line/circle/polygon/triangle/square/star/cube/
tetrahedron/sphere/helix/spiral/pointCloud) place nucleotides along paths.
The duplex builders below instead create ideal B-DNA duplexes
(edit.createStrand seq,true), orient each along its edge via the PCA helix
axis, and auto-ligate meeting ends at vertices (greedy closest 5'/3' pairing —
the viewer figures out where to connect by itself). Edge length → base pairs
at 0.4 units/bp (min 6 bp/edge). Relax the result with oxDNA afterwards.

shapes.duplexEdge(p0, p1, seq?, isRNA?, tag?)   → one duplex along p0→p1 (kind 'duplex')
shapes.outline(points, {closed?, seq?, isRNA?, tag?, ligate?, threshold?})
    → duplex wireframe; edges tagged tag_e0… (kind 'edge'), whole = alias tag.
      Returns elems with .edges=[names], .ligated=n, .pairs=[{aId,bId,dist}].
shapes.triangleDuplex(center, normal, sideLen, seq?, isRNA?, tag?)
    → equilateral duplex triangle (outline convenience wrapper).
shapes.triLattice(nx, ny, sideLen, center?, normal?)
    → pure geometry {verts, edges:[[a,b]], cells:[{verts:[a,b,c], up}]}; no scene change.
shapes.triangleCrystal(center, normal, sideLen, nx, ny, nz,
                       {tag?, seq?, isRNA?, layerGap?, twistDeg?, shift?, threshold?})
    → layered crystal slab: one duplex per UNIQUE lattice edge (no doubling),
      auto-ligated at shared vertices; registry edges tag_L{l}_e{k}, cell aliases
      tag_L{l}_c{i} (3 edges each), layer aliases tag_L{l}, whole alias tag.
      layerGap default sideLen*0.5; twistDeg rotates each layer about the normal
      (120° + shift mimics tensegrity-triangle R3 screw stacking).

WORKFLOW — triangle first, then grow the crystal (always verify each step):
  // 1. Small duplex triangle from a bare prompt like "make a triangle":
  var tri = shapes.triangleDuplex(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 12, null, false, 'tri1');
  notify('tri1: ' + tri.length + ' nt, ' + tri.ligated + ' vertex connections');
  space.show('tri1');
  // 2. Sanity-check before growing: connected? overlapping anything?
  //    (tri.ligated should be 3 for a closed triangle; space.overlaps vs others false)
  // 3. Extend to a crystal slab reusing the same edge length:
  shapes.triangleCrystal(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 12, 2, 2, 2, {tag:'xtal1'});
  space.describe();            // per-edge / per-cell / per-layer ledger digest
  space.overlaps('tri1', 'xtal1');
  space.show('xtal1');

════════════════════════════════════════
NANOCANVAS INTEGRATION (when embedded in integration page)
════════════════════════════════════════
If the user asks to design a structure, build helices, create staples, run wiggle test,
or do anything requiring 2D CAD design, delegate to NanoCanvas via the bridge:

window.__NC_BRIDGE__ functions (available when embedded in integration/nanocanvas_embed.html):
  window.__NC_BRIDGE__.runMethod(method, ...args)   → calls api[method](...args) in NanoCanvas
  window.__NC_BRIDGE__.runCode(jsCode)               → runs arbitrary api.* code in NanoCanvas
  window.__NC_BRIDGE__.syncToOxView()                → converts current NC design → oxDNA → loads here

Examples of delegating to NanoCanvas:
  // Build a star origami in NanoCanvas and load it here:
  if (window.__NC_BRIDGE__) {
    window.__NC_BRIDGE__.runMethod('buildComplexShape', {shape:'star', arms:5});
    setTimeout(() => window.__NC_BRIDGE__.syncToOxView(), 2000);
  }
  render();

  // Run wiggle test and show result:
  if (window.__NC_BRIDGE__) {
    window.__NC_BRIDGE__.runCode('const r = api.evaluateWiggleTest(); notify("Stiffness: " + r.stiffnessScore + "/100 — " + r.rigidityRating, "info"); return r;');
  }
  render();

  // Fix weak regions in NanoCanvas then sync:
  if (window.__NC_BRIDGE__) {
    window.__NC_BRIDGE__.runMethod('fixWeakRegions');
    setTimeout(() => window.__NC_BRIDGE__.syncToOxView(), 1500);
  }
  render();

NOTE: If window.__NC_BRIDGE__ is undefined, the viewer is running standalone (not embedded).
In that case, inform the user they need to open the integration page at integration/nanocanvas_embed.html.
`;

// ─────────────────────────────────────────────────────────────
// Robust chat-completions fetch: AbortController timeout (default
// ~120s), retry with exponential backoff on 429/5xx/network errors
// (max LLM_FETCH_MAX_RETRIES retries). Error classes are
// distinguished so chat-visible messages can point at the fix:
//   - TypeError        → CORS/network failure (provider may block
//                        browser CORS; backend-free operation is fine,
//                        this only affects the LLM call itself)
//   - AbortError       → request timed out
//   - 401/403          → bad/rejected API key (points at key fields)
//   - 429/5xx          → retried with backoff, then reported
// Classic script (no bundler): llm-prefixed globals avoid colliding
// with agent_chat.js, which is loaded on the same page.
// ─────────────────────────────────────────────────────────────
const LLM_FETCH_TIMEOUT_MS = 120000;
const LLM_FETCH_MAX_RETRIES = 3;
const LLM_FETCH_BACKOFF_BASE_MS = 1000;

// Stop support: llmChat.stop() sets llmStopRequested and aborts the
// in-flight attempt; the retry loop checks the flag so no new attempt
// starts after a stop. Scene changes already applied are never reverted.
var llmStopRequested = false;
var llmActiveFetchController = null;

function llmFetchIsRetryableStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}

function llmFetchSleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// POSTs a JSON body and resolves with parsed JSON. Throws Errors whose
// messages are safe to show directly in the chat log.
async function llmChatFetchJson(url, apiKey, body, opts) {
    opts = opts || {};
    var timeoutMs = (opts.timeoutMs != null) ? opts.timeoutMs : LLM_FETCH_TIMEOUT_MS;
    var maxRetries = (opts.maxRetries != null) ? opts.maxRetries : LLM_FETCH_MAX_RETRIES;
    var attempt = 0;
    var lastErr = null;
    while (true) {
        if (llmStopRequested) {
            var _llmStopErr = new Error('STOPPED_BY_USER');
            _llmStopErr._llmStopped = true;
            throw _llmStopErr;
        }
        var controller = null;
        var timer = null;
        try {
            if (typeof AbortController !== 'undefined') {
                controller = new AbortController();
                timer = setTimeout(function () { controller.abort(); }, timeoutMs);
            }
            llmActiveFetchController = controller;
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
            llmActiveFetchController = null;
            if (response.ok) {
                return await response.json();
            }
            var errText = '';
            try { errText = await response.text(); } catch (_) {}
            var detail = '';
            try {
                var parsed = JSON.parse(errText);
                detail = (parsed.error && parsed.error.message) || errText;
            } catch (_) { detail = errText; }
            if (detail && detail.length > 500) detail = detail.substring(0, 500) + '…';
            if (response.status === 401 || response.status === 403) {
                throw new Error('🔑 API key rejected (HTTP ' + response.status + '). '
                    + 'Set a valid key with the 🔑 button (stored as oxview_llm_api_key in localStorage) '
                    + 'or llmApiKey in ts/config.js.' + (detail ? ' Provider says: ' + detail : ''));
            }
            lastErr = new Error(response.status === 429
                ? 'Rate-limited (HTTP 429)' + (detail ? ': ' + detail : '')
                  + ' — retrying with backoff, then giving up.'
                : 'API error ' + response.status + (detail ? ': ' + detail : ''));
            lastErr._llmRetryable = llmFetchIsRetryableStatus(response.status);
            lastErr._llmStatus = response.status;
        } catch (err) {
            if (timer) clearTimeout(timer);
            llmActiveFetchController = null;
            if (err && err._llmStopped) {
                throw err;
            } else if (err && err.name === 'AbortError') {
                if (llmStopRequested) {
                    var _llmAbortStop = new Error('STOPPED_BY_USER');
                    _llmAbortStop._llmStopped = true;
                    throw _llmAbortStop;
                }
                lastErr = new Error('Request timed out after ' + Math.round(timeoutMs / 1000) + 's — '
                    + 'retrying (attempt ' + (attempt + 1) + '/' + (maxRetries + 1) + ').');
                lastErr._llmRetryable = true;
            } else if (err && !err._llmStatus && (err instanceof TypeError)) {
                // fetch() rejects with TypeError on network failure / CORS block.
                lastErr = new Error('Network error: could not reach ' + url + '. '
                    + 'The provider may block browser CORS requests, or you may be offline — '
                    + 'retrying with backoff, then giving up. (' + err.message + ')');
                lastErr._llmRetryable = true;
            } else if (!err._llmRetryable && err._llmStatus == null && !/API key rejected/.test(err.message || '')) {
                // Non-HTTP, non-network error (e.g. JSON parse) — not retryable.
                throw err;
            } else if (!err._llmRetryable) {
                throw err;
            } else {
                lastErr = err;
            }
        }
        if (attempt >= maxRetries || !lastErr._llmRetryable) {
            if (/retrying/i.test(lastErr.message)) {
                lastErr.message += ' Gave up after ' + (attempt + 1) + ' attempt' + (attempt === 0 ? '' : 's') + '.';
            }
            throw lastErr;
        }
        await llmFetchSleep(LLM_FETCH_BACKOFF_BASE_MS * Math.pow(2, attempt));
        attempt++;
    }
}


// ─────────────────────────────────────────────────────────────
// Chat threads — browser-localStorage persistence (UI + storage
// only; no backend, no key material stored here).
// Store: oxview_llm_threads = [{id,title,createdAt,updatedAt,
//   messages:[{role,content}]}], active id in
//   oxview_llm_active_thread. Quota-guarded (message/thread caps,
//   oldest-first pruning, prune-and-retry); a corrupt store
//   degrades to an empty list and never breaks the panel.
// Classic script (no bundler): llmThread-prefixed globals avoid
// colliding with agent_chat.js, loaded on the same page.
// ─────────────────────────────────────────────────────────────
const LLM_THREADS_KEY = 'oxview_llm_threads';
const LLM_ACTIVE_THREAD_KEY = 'oxview_llm_active_thread';
const LLM_MAX_THREADS = 20;
const LLM_MAX_MESSAGES_PER_THREAD = 300;

function llmMakeThreadId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function llmMakeThread(title) {
    var now = Date.now();
    return { id: llmMakeThreadId(), title: title || 'New chat', createdAt: now, updatedAt: now, messages: [] };
}

function llmSanitizeThreads(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    for (var i = 0; i < value.length && out.length < LLM_MAX_THREADS; i++) {
        var t = value[i];
        if (!t || typeof t.id !== 'string' || !Array.isArray(t.messages)) continue;
        var msgs = [];
        for (var j = 0; j < t.messages.length; j++) {
            var m = t.messages[j];
            if (!m || typeof m.content !== 'string') continue;
            msgs.push({
                role: (typeof m.role === 'string') ? m.role : 'assistant',
                content: m.content.slice(0, 4000)
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

function llmLoadThreads() {
    try {
        var raw = localStorage.getItem(LLM_THREADS_KEY);
        if (!raw) return [];
        return llmSanitizeThreads(JSON.parse(raw));
    } catch (_) {
        return [];
    }
}

function llmPruneThreads(threads) {
    var capped = threads.map(function (t) {
        return {
            id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: t.updatedAt,
            messages: t.messages.slice(-LLM_MAX_MESSAGES_PER_THREAD)
        };
    });
    capped.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return capped.slice(0, LLM_MAX_THREADS);
}

// Returns true on success, false on quota/corrupt failure. Never throws.
function llmSaveThreads(threads) {
    try {
        localStorage.setItem(LLM_THREADS_KEY, JSON.stringify(llmPruneThreads(threads)));
        return true;
    } catch (_) {
        try {
            // Quota hit: keep only the newest half and retry once.
            var pruned = llmPruneThreads(threads).slice(0, Math.max(1, Math.floor(LLM_MAX_THREADS / 2)));
            localStorage.setItem(LLM_THREADS_KEY, JSON.stringify(pruned));
            return true;
        } catch (_) {
            return false;
        }
    }
}


const llmChat = {
    isOpen: false,
    history: [],
    isRunning: false,
    threads: [],
    activeThreadId: null,
    _threadsReady: false,

    // Stop the in-flight run: aborts the LLM fetch; if the response
    // already arrived, sendMessage() skips code execution. Safe no-op
    // when idle. Applied scene changes are never reverted.
    stop() {
        if (!this.isRunning) return;
        llmStopRequested = true;
        try { if (llmActiveFetchController) llmActiveFetchController.abort(); } catch (_) {}
    },

    _updateStopBtn() {
        var btn = document.getElementById('llm-chat-stop');
        if (btn) btn.disabled = !this.isRunning;
    },

    toggle() {
        const panel = document.getElementById('llm-chat-panel');
        this.isOpen = !this.isOpen;
        panel.style.display = this.isOpen ? 'flex' : 'none';
        if (this.isOpen) {
            document.getElementById('llm-chat-input').focus();
            this.initModelUI();
            try { this.initThreads(); } catch (_) {}
            // Show the reference grid + axes so positions are legible.
            try { if (window.space) space.grid(true); } catch (_) {}
        }
    },

    // ─────────────────────────────────────────────────────────
    // Threads: New / Open / Delete / Rename over the
    // localStorage store above. Autosaved on every message via
    // persistThreads(); the active thread is restored on reload.
    // ─────────────────────────────────────────────────────────
    initThreads() {
        try {
            if (this._threadsReady) { try { this.persistThreads(); } catch (_) {} }
            var ts = llmLoadThreads();
            var aid = null;
            try { aid = localStorage.getItem(LLM_ACTIVE_THREAD_KEY); } catch (_) {}
            var has = function (id) { return ts.some(function (t) { return t.id === id; }); };
            if (!aid || !has(aid)) {
                if (ts.length) {
                    var sorted = ts.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
                    aid = sorted[0].id;
                } else {
                    var t0 = llmMakeThread('Chat 1');
                    ts = [t0];
                    aid = t0.id;
                    llmSaveThreads(ts);
                }
                try { localStorage.setItem(LLM_ACTIVE_THREAD_KEY, aid); } catch (_) {}
            }
            this.threads = ts;
            this.activeThreadId = aid;
            var active = null;
            ts.forEach(function (t) { if (t.id === aid) active = t; });
            // Adopt saved messages only when this client has nothing
            // newer in memory (e.g. first load / reload).
            if (!this._threadsReady || !this.history.length) {
                this.history = active ? active.messages.map(function (m) { return { role: m.role, content: m.content }; }) : [];
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
            this.history.forEach(function (m) {
                if (!firstUser && m && m.role === 'user' && m.content) firstUser = m.content;
            });
            this.threads = this.threads.map(function (t) {
                if (t.id !== self.activeThreadId) return t;
                var title = t.title;
                if (/^(New chat|Chat \d+|Untitled)$/.test(title) && firstUser) {
                    title = firstUser.trim().slice(0, 48) || title;
                }
                return {
                    id: t.id, title: title, createdAt: t.createdAt, updatedAt: Date.now(),
                    messages: self.history.slice(-LLM_MAX_MESSAGES_PER_THREAD).map(function (m) {
                        return { role: m.role, content: (m.content || '').slice(0, 4000) };
                    })
                };
            });
            try { localStorage.setItem(LLM_ACTIVE_THREAD_KEY, this.activeThreadId); } catch (_) {}
            return llmSaveThreads(this.threads);
        } catch (_) { return false; }
    },

    renderThreadList() {
        try {
            var sel = document.getElementById('llm-thread-list');
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
            var log = document.getElementById('llm-chat-log');
            if (!log || !this.history.length) return;
            log.innerHTML = '';
            var self = this;
            this.history.forEach(function (m) { self.renderMessage(m.role, m.content); });
        } catch (_) {}
    },

    newThread() {
        try {
            this.persistThreads();
            var t = llmMakeThread('Chat ' + (this.threads.length + 1));
            this.threads = llmPruneThreads(this.threads.concat([t]));
            this.activeThreadId = t.id;
            this.history = [];
            this.persistThreads();
            this.renderThreadList();
            var log = document.getElementById('llm-chat-log');
            if (log) {
                log.innerHTML = '';
                this.renderMessage('system', 'New thread started. History is saved in this browser only.');
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
            this.history = found.messages.map(function (m) { return { role: m.role, content: m.content }; });
            this.persistThreads();
            this.renderThreadList();
            var log = document.getElementById('llm-chat-log');
            if (log) {
                log.innerHTML = '';
                if (this.history.length) {
                    this.renderActiveThread();
                } else {
                    this.renderMessage('system', 'Thread "' + found.title + '" opened — no saved messages yet.');
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
            if (!this.threads.length) this.threads = [llmMakeThread('Chat 1')];
            var sorted = this.threads.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
            this.activeThreadId = sorted[0].id;
            var self = this;
            var active = null;
            this.threads.forEach(function (t) { if (t.id === self.activeThreadId) active = t; });
            this.history = active ? active.messages.slice() : [];
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
            llmSaveThreads(this.threads);
            this.renderThreadList();
        } catch (_) {}
    },

    addMessage(role, content) {
        this.history.push({ role, content });
        this.renderMessage(role, content);
        try { this.persistThreads(); } catch (_) {}
    },

    renderMessage(role, content) {
        const log = document.getElementById('llm-chat-log');
        if (!log) return;
        const msg = document.createElement('div');
        msg.className = `llm-msg llm-msg-${role}`;
        msg.textContent = content;
        log.appendChild(msg);
        log.scrollTop = log.scrollHeight;
    },

    renderCode(code) {
        const log = document.getElementById('llm-chat-log');
        if (!log) return;
        const msg = document.createElement('div');
        msg.className = 'llm-msg llm-msg-code';
        msg.textContent = '▶ ' + code;
        log.appendChild(msg);
        log.scrollTop = log.scrollHeight;
    },

    renderImage(dataUrl) {
        if (!dataUrl) return;
        const log = document.getElementById('llm-chat-log');
        if (!log) return;
        const msg = document.createElement('div');
        msg.className = 'llm-msg llm-msg-system';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.maxWidth = '100%';
        img.style.borderRadius = '4px';
        img.style.cursor = 'zoom-in';
        img.title = 'click to open full size';
        img.onclick = () => { const w = window.open(); if (w) w.document.write('<img src="' + dataUrl + '">'); };
        msg.appendChild(img);
        log.appendChild(msg);
        log.scrollTop = log.scrollHeight;
    },

    async sendMessage() {
        if (this.isRunning) return;
        const input = document.getElementById('llm-chat-input');
        const sendBtn = document.getElementById('llm-chat-send');
        const userText = input.value.trim();
        if (!userText) return;

        input.value = '';
        input.disabled = true;
        sendBtn.disabled = true;
        this.isRunning = true;
        llmStopRequested = false;
        this._updateStopBtn();

        this.addMessage('user', userText);

        if (!LLM_CONFIG.apiKey) {
            this.renderMessage('error', 'No API key. Add one with the 🔑 button, or set llmApiKey in ts/config.js.');
            input.disabled = false; sendBtn.disabled = false; input.focus();
            return;
        }

        // Live scene digest so the model always knows what exists and where.
        let sceneBlock = '';
        try {
            if (window.space && typeof space.describe === 'function') {
                sceneBlock = space.describe();
            }
        } catch (_) {}

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...(sceneBlock ? [{ role: 'system', content: 'CURRENT SCENE (live):\n' + sceneBlock }] : []),
            ...this.history
        ];

        try {
            this.renderMessage('assistant', '...');
            const log = document.getElementById('llm-chat-log');
            const thinking = log.lastChild;

            const data = await llmChatFetchJson(`${LLM_CONFIG.baseURL}/chat/completions`, LLM_CONFIG.apiKey, {
                model: LLM_CONFIG.model,
                messages: messages,
                temperature: 0.1,
                max_tokens: 16000
            });

            // Stop arrived after the response: skip code execution entirely.
            // Anything already applied to the scene stays applied (no revert).
            if (llmStopRequested) {
                thinking.remove();
                this.renderMessage('system', '⏹ Stopped — response discarded, nothing executed.');
                return;
            }

            const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
            // Thinking models sometimes leave content empty and put everything in
            // reasoning; salvage a fenced code block from reasoning if so.
            let rawContent = msg.content || '';
            if (!rawContent.trim() && msg.reasoning) {
                const rc = msg.reasoning.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
                if (rc) rawContent = rc[0];
            }
            if (!rawContent.trim() && data.choices && data.choices[0] && data.choices[0].finish_reason === 'length') {
                throw new Error('Model ran out of tokens before answering (finish_reason=length). Try a shorter request.');
            }

            // Extract code — find the first code fence block anywhere in the response,
            // then fall back to the raw content if no fences are present.
            let code = rawContent.trim();
            const fenceMatch = code.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
            if (fenceMatch) {
                code = fenceMatch[1].trim();
            }
            // Strip stray <think>…</think> blocks some models emit inline
            code = code.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            thinking.remove();

            // Show a short excerpt of the model's thinking chain
            if (msg.reasoning) {
                const excerpt = msg.reasoning.length > 150
                    ? msg.reasoning.substring(0, 150) + '...'
                    : msg.reasoning;
                this.renderMessage('system', '💭 ' + excerpt);
            }

            this.history.push({ role: 'assistant', content: rawContent });
            try { this.persistThreads(); } catch (_) {}

            // Safety check — if the extracted text has no JS-like tokens the model
            // returned prose instead of code; show a friendly error instead of a
            // cryptic syntax error from new Function().
            const looksLikeJs = /\b(var|let|const|function|edit\.|api\.|shapes\.|space\.|llmTracker\.|systems|render\(|notify\(|THREE\.|colorElements|translateElements|rotateElements)\b/.test(code);
            if (!looksLikeJs) {
                this.renderMessage('error', '⚠ Model returned an explanation instead of code. Try rephrasing your command more specifically.');
                console.warn('LLM returned prose instead of JS:', rawContent);
            } else {
                this.renderCode(code);
                // Execute in global scope, then force a render pass
                try {
                    (new Function(code))();
                    if (typeof render === 'function') render();
                } catch (execErr) {
                    this.renderMessage('error', 'Execution error: ' + execErr.message);
                    console.error('LLM eval error:', execErr, '\nCode:', code);
                }
                // Post-execution: show the updated scene digest, and a snapshot
                // image when the user asked to "show"/"see"/"render" the result.
                try {
                    if (window.space && typeof space.describe === 'function') {
                        this.renderMessage('system', '🧭 ' + space.describe());
                    }
                    if (/\b(show|see|render|screenshot|picture|image|output|look)\b/i.test(userText)
                        && !/space\.show\s*\(/.test(code)
                        && window.space && typeof space.snapshotImage === 'function') {
                        this.renderImage(space.snapshotImage());
                    }
                } catch (_) {}
            }

        } catch (err) {
            const log = document.getElementById('llm-chat-log');
            if (log.lastChild && log.lastChild.textContent === '...') {
                log.lastChild.remove();
            }
            if (err && (err.message === 'STOPPED_BY_USER' || err._llmStopped)) {
                this.renderMessage('system', '⏹ Stopped.');
            } else {
                this.renderMessage('error', 'Error: ' + err.message);
                console.error('LLM fetch error:', err);
            }
        } finally {
            this.isRunning = false;
            llmStopRequested = false;
            llmActiveFetchController = null;
            input.disabled = false;
            sendBtn.disabled = false;
            this._updateStopBtn();
            input.focus();
        }
    },

    clearHistory() {
        this.history = [];
        document.getElementById('llm-chat-log').innerHTML = '';
        this.renderMessage('system', 'Chat cleared. History reset.');
        try { this.persistThreads(); } catch (_) {}
    },

    // ─────────────────────────────────────────────────────────────
    // Model fetch-and-pick (direct browser fetch, no backend).
    // Persists to 'nc_ai_model' — the same localStorage key
    // LLM_CONFIG.model already reads. The free-text input stays as
    // the fallback so custom model IDs remain typeable.
    // ─────────────────────────────────────────────────────────────
    initModelUI() {
        try {
            var input = document.getElementById('llm-model-input');
            if (input && !input.value) input.value = LLM_CONFIG.model;
        } catch (_) {}
    },

    onModelInput(value) {
        try { localStorage.setItem('nc_ai_model', (value || '').trim()); } catch (_) {}
    },

    pickModel(id) {
        if (!id) return;
        try { localStorage.setItem('nc_ai_model', id); } catch (_) {}
        var input = document.getElementById('llm-model-input');
        if (input) input.value = id;
    },

    setApiKey() {
        var current = LLM_CONFIG.apiKey;
        var input = prompt(
            'Enter your API key.\nIt will be saved in localStorage.\nLeave blank to clear.',
            current
        );
        if (input === null) return; // cancelled
        if (input.trim()) {
            try { localStorage.setItem('oxview_llm_api_key', input.trim()); } catch (_) {}
            this.renderMessage('system', '🔑 API key saved.');
        } else {
            try { localStorage.removeItem('oxview_llm_api_key'); } catch (_) {}
            this.renderMessage('system', '🔑 API key cleared.');
        }
    },

    async refreshModels() {
        var errEl = document.getElementById('llm-models-error');
        var btn = document.getElementById('llm-models-refresh');
        var picker = document.getElementById('llm-model-picker');
        var showErr = function (msg) {
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            llmChat.renderMessage('error', msg);
        };
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        if (!LLM_CONFIG.apiKey) {
            showErr('No API key set — the /models call needs Authorization: Bearer <key>. Set one with the 🔑 button first.');
            return;
        }
        var url = LLM_CONFIG.baseURL.replace(/\/+$/, '') + '/models';
        if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
        try {
            var response = await fetch(url, {
                headers: { 'Authorization': 'Bearer ' + LLM_CONFIG.apiKey }
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
                        + 'Set a valid key with the 🔑 button (stored as oxview_llm_api_key in localStorage).'
                        + (detail ? ' Provider says: ' + detail : ''));
                }
                throw new Error('API error ' + response.status + ' from ' + url + '.'
                    + (detail ? ' ' + detail : ' Check llmBaseURL in ts/config.js.'));
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
                    + 'check llmBaseURL in ts/config.js points at an OpenAI-compatible endpoint.');
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
            this.renderMessage('system', 'Loaded ' + ids.length + ' models from ' + url + '.');
        } catch (err) {
            if (err && (err instanceof TypeError)) {
                // fetch() rejects with TypeError on network failure / CORS block.
                showErr('Network error: could not reach ' + url + '. '
                    + 'The provider may block browser CORS requests, or you may be offline — '
                    + 'check llmBaseURL in ts/config.js and that the provider permits CORS from this page. ('
                    + err.message + ')');
            } else {
                showErr('Error: ' + err.message);
            }
            console.error('LLM /models fetch error:', err);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '⟳ Models'; }
        }
    },

    handleKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            llmChat.sendMessage();
        }
    }
};

// Expose for spatial_api's space.show() and other modules (top-level const is
// not automatically a window property in classic scripts).
try { window.llmChat = llmChat; } catch (e) {}
try { llmChat.initModelUI(); } catch (e) {}
try { llmChat.initThreads(); } catch (e) {}
