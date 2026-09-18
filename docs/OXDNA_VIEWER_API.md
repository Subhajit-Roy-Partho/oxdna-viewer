# oxDNA-Viewer API Documentation

## Overview

oxView is a browser-based 3D visualization and editing tool for oxDNA structures. Built with **Electron**, **TypeScript**, and **Three.js**, it provides both a graphical interface and a comprehensive **JavaScript console API** for programmatic structure manipulation.

**Tech Stack:**
- Platform: Electron (desktop app with Node.js integration)
- Language: TypeScript (101 files) → Compiled JavaScript
- 3D Rendering: Three.js with instanced rendering (supports 1M+ nucleotides)
- Build: TypeScript compiler (`tsc`)

---

## Architecture

### Two API Layers

1. **Browser Console API** (`api.*` and `edit.*` modules)
   - Accessible via developer console (F12)
   - Direct JavaScript execution in global scope
   - Used by built-in AI chat agent

2. **LLM/Agent API** (extended with helper functions)
   - `window.shapes.*` - Geometric shape creation
   - `window.api.getCOM()`, `api.rotateGroup()`, etc.
   - Tag-based element tracking for agents

---

## Data Model

### Element Hierarchy

```
BasicElement (abstract base class)
├── id: number          // Global unique ID
├── sid: number         // System-local ID
├── label: string       // Human-readable name
├── n3: BasicElement    // 3' neighbor
├── n5: BasicElement    // 5' neighbor
├── strand: Strand      // Parent strand
├── type: string        // Base type (A/T/G/C/U) or amino acid
├── clusterId: number   // Cluster membership
├── color: THREE.Color  // Display color
│
└── Nucleotide (extends BasicElement)
    ├── pair: Nucleotide | null  // Base-paired partner
    ├── getA1(), getA3()         // Orientation vectors
    ├── isDNA(), isRNA()
    │
    ├── DNANucleotide (extends Nucleotide)
    │   └── Weak pyrimidine = 'T'
    │
    └── RNANucleotide (extends Nucleotide)
        └── Weak pyrimidine = 'U'
```

### Container Hierarchy

```
Strand (abstract)
├── id: number
├── system: System
├── label: string
├── end3: BasicElement  // 3' end
├── end5: BasicElement  // 5' end
├── getLength(): number
├── getSequence(): string
├── forEach(callback)
├── isCircular(): boolean
│
├── DNA (extends Strand) - DNA nucleotide container
├── RNA (extends Strand) - RNA nucleotide container
└── Peptide (extends Strand) - Amino acid container

System
├── id: number
├── globalStartId: number
├── strands: Strand[]
├── instanceParams: Map<string, number>  // GPU buffer metadata
├── callUpdates(['instanceColor', 'instanceOffset', ...])
└── Meshes: backbone, nucleoside, connector, bbconnector
```

### Global State

```typescript
// Located in ts/main.ts

elements: ElementMap           // All BasicElements indexed by ID
systems: System[]              // All loaded systems
selectedBases: smartSet<BasicElement>  // Current selection
tmpSystems: System[]           // Newly created (uncommitted) elements
editHistory: EditHistory       // Undo/redo stack
box: THREE.Vector3             // Periodic boundary box
```

---

## Console API - Scene & Visualization (`api.*`)

Located in: `ts/api/scene_api.ts`

### Selection

```javascript
api.selectElements(elems: BasicElement[], keepPrevious?: boolean)
// Select elements. If keepPrevious=false (default), clears existing selection

api.selectElementIDs(ids: number[], keepPrevious?: boolean)
// Select by global ID array

api.selectPDBIDs(targetPDB: number[], chainids?: string[], keepPrevious?: boolean)
// Select by PDB residue numbers + optional chain IDs

api.clearSelection()
// Deselect all elements

// Example:
api.selectElements([systems[0].strands[0].end5]);
api.selectElementIDs([0, 1, 2, 3, 4], true);  // Add to selection
```

### Element Queries

```javascript
api.getElements(ids: number[]): BasicElement[]
// Retrieve elements by ID array
// Returns: Array of BasicElements

api.countStrandLength(system?: System): {[length: number]: Strand[]}
// Get dictionary mapping strand lengths to strand arrays
// Returns: {8: [strand1, strand2], 16: [strand3], ...}

// Example:
let lengths = api.countStrandLength(systems[0]);
console.log("Strands of length 16:", lengths[16]);
```

### Strand Operations

```javascript
api.toggleStrand(strand: Strand): Strand
// Toggle visibility of all elements in strand
// Returns: The strand

api.highlight5ps(system?: System)
// Select all 5' ends in system (default: systems[0])

api.highlight3ps(system?: System)
// Select all 3' ends in system

api.trace53(monomer: BasicElement): BasicElement[]
// Trace strand from monomer → 5' direction
// Returns: Array of elements

api.trace35(monomer: BasicElement): BasicElement[]
// Trace strand from monomer → 3' direction

// Example:
let scaffold = systems[0].strands[0];
api.toggleStrand(scaffold);  // Hide scaffold
```

### Visibility & Display

```javascript
api.toggleElements(elems: BasicElement[])
// Toggle visibility of specific elements

api.toggleAll(system?: System)
// Toggle visibility of entire system

api.toggleBaseColors()
// Toggle between type-based colors (A=blue, T=red, G=yellow, C=green) and grey

api.spOnly()
// Show only backbone cylinders (licorice display)

api.showEverything()
// Reset all visibility to default

// Example:
api.spOnly();  // Minimal view
api.showEverything();  // Reset
```

### Colorbar & Overlays

```javascript
api.removeColorbar()
// Hide colorbar (after loading overlay JSON)

api.showColorbar()
// Show previously hidden colorbar

api.changeColormap(mapName: string)
// Change overlay colormap
// Available: All Matplotlib colormaps + 'rainbow', 'cooltowarm', 'blackbody', 'grayscale'

api.setColorBounds(min: number, max: number)
// Set colorbar range limits

// Example:
api.changeColormap('viridis');
api.setColorBounds(0, 100);
```

### Camera

```javascript
api.switchCamera()
// Toggle perspective ↔ orthographic camera
```

### 3' End Markers

```javascript
api.update3primeMarkers(diameter: number, length: number, spacing: number)
// Show geometric markers at 3' ends
// diameter: Marker cylinder diameter
// length: Marker cylinder length
// spacing: Distance from backbone sphere

// Example:
api.update3primeMarkers(0.5, 2.0, 0.3);
```

---

## Console API - Structure Editing (`edit.*`)

Located in: `ts/api/editing_api.ts` (1603 lines)

### Create Strands

```javascript
edit.createStrand(sequence: string, createDuplex?: boolean, isRNA?: boolean): Strand | Strand[]
// Create single strand or duplex 20 units in front of camera
// sequence: "ATCG..." (uppercase required)
// createDuplex: If true, creates base-paired double helix
// isRNA: If true, uses U instead of T
// Returns: Single strand or [strand1, strand2] for duplex

// Example:
let strand = edit.createStrand("ATCGATCG");
let duplex = edit.createStrand("GCGCGCGC", true);  // [forward, reverse]
```

### Extend Strands

```javascript
edit.extendStrand(end: BasicElement, sequence: string): BasicElement[]
// Extend strand from 3' or 5' end
// Returns: Array of newly added elements

edit.extendDuplex(end: Nucleotide, sequence: string): [BasicElement[], BasicElement[]]
// Extend double helix from end
// Returns: [forward additions, reverse additions]

// Example:
let end5 = systems[0].strands[0].end5;
edit.extendStrand(end5, "GGGGGGGG");
```

### Insert & Delete

```javascript
edit.insert(e: BasicElement, sequence: string): BasicElement[]
// Insert bases between e and e.n3
// Nicks strand, extends, moves new bases to interpolated positions, ligates
// Returns: Inserted elements

edit.skip(elems: BasicElement[])
// Remove elements and ligate neighbors (keeps connectivity)

edit.deleteElements(victims: BasicElement[])
// Delete elements entirely (may break strands)

// Example:
let elem = elements.get(100);
edit.insert(elem, "TTTT");  // Insert 4 Ts after elem
edit.skip([elem]);  // Remove elem but maintain backbone
```

### Nick & Ligate

```javascript
edit.nick(element: BasicElement)
// Break backbone connection at element
// Creates new strand: [3'--strand--element] [element.n3--newStrand--5']

edit.ligate(a: BasicElement, b: BasicElement)
// Join two strand ends
// a and b must have compatible free ends (one 5', one 3')

// Example:
let e = systems[0].strands[0].getMonomers()[10];
edit.nick(e);  // Split strand at position 10
edit.ligate(systems[0].strands[0].end3, systems[0].strands[1].end5);
```

### Sequence Manipulation

```javascript
edit.setSequence(elems: Set<BasicElement>, sequence: string, setComplementaryBases?: boolean)
// Change base types of elements
// sequence: String of base types (wraps if longer than elems)
// setComplementaryBases: If true, also sets paired bases to complement

edit.getSequence(elems: Set<BasicElement>): string
// Read sequence of elements
// Returns: String like "ATCGATCG"

// Example:
let strand = systems[0].strands[0];
let monomers = new Set(strand.getMonomers());
edit.setSequence(monomers, "AAAAAAA", true);  // Poly-A + complement
```

### Base Pairing

```javascript
edit.createBP(elem: Nucleotide, undoable?: boolean)
// Create base pair between elem and its complement (if positioned correctly)
// Automatically finds nearby complementary base

// Example:
let nuc = systems[0].strands[0].getMonomers()[5];
edit.createBP(nuc, true);  // Try to pair
```

### Duplex Interconnection

```javascript
edit.interconnectDuplex3p(strand1: Strand, strand2: Strand, sequence: string)
// Connect two strands via their 3' ends with duplex patch

edit.interconnectDuplex5p(strand1: Strand, strand2: Strand, sequence: string)
// Connect two strands via their 5' ends with duplex patch

// Example:
edit.interconnectDuplex3p(systems[0].strands[0], systems[0].strands[1], "GGGGGGGG");
```

---

## Structure Factory (`structureFactory.*`)

Located in: `ts/api/structure_factory.ts` (270 lines)

Pre-built DNA nanostructure motifs. All created at origin with ideal B-DNA geometry (require relaxation before simulation).

```javascript
structureFactory.createHollidayJunction(armLength?: number, sequences?: string[]): System
// 4-way branched junction (mobile or immobile)
// Default armLength = 8
// Returns: New system with junction

structureFactory.createThreeWayJunction(armLength?: number): System
// 3-arm junction with 120° angles
// Default armLength = 8

structureFactory.createDXTile(length?: number, crossoverSpacing?: number): System
// Double-crossover tile (two parallel duplexes, antiparallel)
// Default: length=16, spacing=8

structureFactory.createSingleCrossoverTile(length?: number): System
// Two parallel duplexes with one crossover
// Default length = 16

structureFactory.createDXLattice(rows?: number, cols?: number, tileLength?: number): System
// 2D grid of DX tiles
// Default: rows=2, cols=2, tileLength=16

structureFactory.createTensegrityTriangle(edgeLength?: number): System
// Triangle motif with 3 duplex edges (for 3D crystallography)
// Default edgeLength = 10

structureFactory.createStapleConnector(sequence?: string): System
// Short duplex for DNA origami staple/scaffold bridging
// Default sequence = "GGGGGGGG"

// Example:
let junction = structureFactory.createHollidayJunction(10);
let lattice = structureFactory.createDXLattice(3, 3, 20);
```

---

## Transformation API

Located in: `ts/editing/translation.ts` and `ts/api/transform_api.js`

### Translate (Move) Elements

```javascript
translateElements(elems: Set<BasicElement>, displacement: THREE.Vector3)
// Move elements by displacement vector
// CRITICAL: This is the ONLY correct way to move elements
// Do NOT use system.position.set() or element.position.set()

// Example (move to specific position):
let targets = new Set(Array.from(selectedBases));
let currentCOM = api.getCOM(targets);  // Get center of mass
let targetPos = new THREE.Vector3(10, 0, 0);
translateElements(targets, targetPos.sub(currentCOM));
render();
```

### Rotate Elements

```javascript
rotateElementsByQuaternion(elems: Set<BasicElement>, rotation: THREE.Quaternion)
// Rotate elements by quaternion around their center of mass

api.rotateGroup(elems: BasicElement[], axis: THREE.Vector3, angleDeg: number, pivot?: THREE.Vector3)
// Rotate group of elements around axis (passing through pivot or COM)
// axis: Unit vector (e.g. new THREE.Vector3(0, 0, 1) for Z)
// angleDeg: Rotation in degrees
// pivot: Optional rotation center (default: COM)

api.rotateSingle(elem: BasicElement, axis: THREE.Vector3, angleDeg: number, pivot?: THREE.Vector3)
// Rotate single element (updates a1, a3 orientation vectors)

// Example:
let group = Array.from(selectedBases);
let zAxis = new THREE.Vector3(0, 0, 1);
api.rotateGroup(group, zAxis, 90);  // 90° around Z through COM
render();
```

### Geometry Helpers

```javascript
api.getCOM(elems: BasicElement[]): THREE.Vector3
// Get center of mass of elements
// Returns: THREE.Vector3

api.getPCA(elems: BasicElement[]): {pc1, pc2, pc3, center}
// Principal component analysis
// Returns: {
//   pc1: THREE.Vector3,  // Primary axis (eigenvector 1)
//   pc2: THREE.Vector3,  // Secondary axis
//   pc3: THREE.Vector3,  // Tertiary axis
//   center: THREE.Vector3  // Centroid
// }

// Example:
let pca = api.getPCA(Array.from(selectedBases));
api.rotateGroup(Array.from(selectedBases), pca.pc1, 180);
```

---

## Geometric Shapes API (`window.shapes.*`)

Located in: `ts/api/shapes_api.js` (~600 lines)

Programmatic shape generation for LLM agents. All shapes can be tagged for later reference.

### Linear Shapes

```javascript
shapes.line(
    p1: THREE.Vector3,           // Start point
    p2: THREE.Vector3,           // End point
    nBases: number,              // Number of bases
    seq?: string,                // Sequence (default: all A)
    isRNA?: boolean,             // Use RNA (default: DNA)
    tagName?: string             // Tag for tracking
): Strand

// Example:
let start = new THREE.Vector3(0, 0, 0);
let end = new THREE.Vector3(10, 0, 0);
shapes.line(start, end, 20, "ATCGATCG", false, "myLine");
```

### Circular Shapes

```javascript
shapes.circle(
    center: THREE.Vector3,       // Circle center
    normal: THREE.Vector3,       // Plane normal (unit vector)
    radius: number,              // Circle radius
    nBases: number,              // Number of bases
    seq?: string,
    isRNA?: boolean,
    tagName?: string
): Strand

shapes.polygon(
    nSides: number,              // Number of sides
    center: THREE.Vector3,
    normal: THREE.Vector3,
    radius: number,              // Circumradius
    bps: number,                 // Bases per side
    seq?: string,
    isRNA?: boolean,
    tagName?: string
): Strand[]  // Returns one strand per side

shapes.triangle(center, normal, sideLen, bps, seq?, isRNA?, tagName?): Strand[]
shapes.square(center, normal, sideLen, bps, seq?, isRNA?, tagName?): Strand[]

// Example:
let up = new THREE.Vector3(0, 0, 1);
shapes.circle(new THREE.Vector3(0, 0, 0), up, 5, 50);
shapes.triangle(new THREE.Vector3(10, 0, 0), up, 8, 16);
```

### 3D Shapes

```javascript
shapes.cube(
    center: THREE.Vector3,
    sideLen: number,             // Edge length
    bpe: number,                 // Bases per edge
    seq?: string,
    isRNA?: boolean,
    tagName?: string
): Strand[]  // 12 strands (one per edge)

shapes.tetrahedron(center, sideLen, bpe, seq?, isRNA?, tagName?): Strand[]
// 6 strands (one per edge)

shapes.sphere(
    center: THREE.Vector3,
    radius: number,
    nBases: number,              // Total bases (distributed on surface)
    seq?: string,
    isRNA?: boolean,
    tagName?: string
): Strand

// Example:
shapes.cube(new THREE.Vector3(0, 0, 0), 10, 20);
```

### Helical Shapes

```javascript
shapes.helix(
    center: THREE.Vector3,
    axis: THREE.Vector3,         // Helix axis (unit vector)
    radius: number,              // Helix radius
    rise: number,                // Rise per turn
    turns: number,               // Number of complete turns
    nBases: number,              // Bases per turn
    seq?: string,
    isRNA?: boolean,
    tagName?: string
): Strand

// Example:
let axis = new THREE.Vector3(0, 1, 0);  // Along Y
shapes.helix(new THREE.Vector3(0, 0, 0), axis, 3, 10, 5, 32);
```

### Custom Point Clouds

```javascript
shapes.pointCloud(
    points: THREE.Vector3[],     // Array of positions
    seq?: string,
    isRNA?: boolean,
    tagName?: string
): Strand

// Example:
let pts = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(2, 0, 2)
];
shapes.pointCloud(pts, "GGG");
```

### Utility

```javascript
shapes.basesForLength(length: number, spacing?: number): number
// Calculate number of bases needed for a given length
// spacing: Default = 0.6 nm (B-DNA rise)

// Example:
let n = shapes.basesForLength(10);  // ~17 bases for 10 nm
```

---

## LLM Element Tagging (`window.tagTracker`)

Located in: `ts/api/llm_tracker_api.js`

Persistent element tagging for LLM agents to reference elements across turns.

```javascript
tagTracker.tag(elems: BasicElement[], tagName: string)
// Tag elements with a name (stored in localStorage)

tagTracker.getTagged(tagName: string): BasicElement[]
// Retrieve elements by tag name
// Returns: Array of BasicElements (or [] if tag not found)

tagTracker.listTags(): string[]
// Get all tag names
// Returns: ["myLine", "scaffold", "staple1", ...]

tagTracker.removeTag(tagName: string)
// Delete a tag

tagTracker.clearAll()
// Remove all tags

// Example (across LLM chat turns):
// Turn 1:
shapes.line(new THREE.Vector3(0,0,0), new THREE.Vector3(10,0,0), 20);
let created = Array.from(systems[systems.length-1].getMonomers());
tagTracker.tag(created, "horizontalLine");

// Turn 2 (later):
let line = tagTracker.getTagged("horizontalLine");
api.rotateGroup(line, new THREE.Vector3(0,0,1), 45);
```

---

## Observables (`api.observable.*`)

Located in: `ts/api/observable_api.ts`

Dynamic visual aids that update during trajectory playback.

### Center of Mass Sphere

```javascript
api.observable.CMS(elements: BasicElement[], size: number, color: number): CMS
// Create sphere at center of mass
// Updates position on trajectory frame change

// Example:
let cms = new api.observable.CMS(selectedBases, 1, 0xFF0000);
```

### Particle Track

```javascript
api.observable.Track(particle: THREE.Mesh): Track
// Create line trail following particle motion

// Example (combined with CMS):
let cms = new api.observable.CMS(selectedBases, 1, 0xFF0000);
let track = new api.observable.Track(cms);
let update_func = () => {
    cms.calculate();
    track.calculate();
};
systems[systems.length-1].reader.nextConfig = api.observable.wrap(
    systems[systems.length-1].reader.nextConfig, update_func
);
```

### Mean Orientation

```javascript
api.observable.MeanOrientation(bases: BasicElement[], len?: number, color?: number): MeanOrientation
// Draw vector showing mean orientation (for nick visualization)
// len: Vector length (default 10)
// color: Hex color (default 0xFF0000)

// Example (visualize nick between two bases):
let flanking = [elements.get(10), elements.get(11)];
let ori = new api.observable.MeanOrientation(flanking);
render = api.observable.wrap(render, () => {ori.update()});
```

---

## Undo/Redo

Located in: `ts/editing/doUndo.ts`

All structural edits are automatically added to the undo history.

```javascript
editHistory.undo()
// Revert last edit
// Returns: true if successful, false if stack empty

editHistory.redo()
// Reapply last undone edit
// Returns: true if successful

editHistory.clear()
// Clear entire history

// Example:
edit.createStrand("ATCG");
editHistory.undo();  // Remove strand
editHistory.redo();  // Restore strand
```

---

## UI & Notifications

Located in: `ts/UI/UI.ts`

### Notifications

```javascript
notify(message: string, type?: string, keepOpen?: boolean, title?: string)
// Show toast notification
// type: 'alert' (red), 'warning' (yellow), 'info' (blue), 'success' (green)
// keepOpen: If true, notification stays until user dismisses

// Example:
notify("Structure created!", "success");
notify("Selection is empty", "warning");
```

### Element Coloring

```javascript
colorElements(color: THREE.Color, elems?: BasicElement[])
// Set element colors
// CRITICAL: ALWAYS pass elems explicitly
// If elems omitted, uses selectedBases (which gets cleared after coloring)

// WRONG:
colorElements(new THREE.Color(1, 0, 0));  // May do nothing

// RIGHT:
let targets = Array.from(selectedBases);
colorElements(new THREE.Color(1, 0, 0), targets);
render();
```

### View State

```javascript
view.update3pMarker(elem: BasicElement, diameter?, length?, spacing?)
// Update 3' end marker for element

flux
// Global array tracking UI state (used internally)
```

---

## File I/O

### Loading Files

Files are loaded via:
1. Drag & drop onto viewer window
2. `readFilesFromURLPath(paths: string[])` for programmatic loading
3. `handleFiles(files: FileList)` for File API integration

**Supported Formats:**
- oxDNA: `.top` + `.dat`/`.conf`/`.oxdna`
- PDB: `.pdb`, `.pdb1`, `.pdb2`
- mmCIF: `.cif`, `.mmcif`
- oxView: `.oxview` (JSON with clusters + base pairs)
- UNF: `.unf`
- XYZ: `.xyz`
- Trajectory overlays: `.json`, force files, mass files, selection files

### Exporting Files

Located in: `ts/file_handling/output_file.ts`

```javascript
makeOutputFiles()
// Generate topology + configuration files for download
// Exports all systems combined

make_pdb()
// Export as PDB format

make_gltf()
// Export 3D scene as GLTF

make_stl()
// Export 3D scene as STL (for 3D printing)
```

---

## Rendering & Performance

### GPU Instancing

oxView uses Three.js instanced rendering to efficiently display millions of nucleotides.

**Instance Buffers (per System):**
- `bbOffsets` - Backbone sphere positions (3 floats/element)
- `nsOffsets` - Nucleoside positions (3 floats/element)
- `rotations` - Orientation quaternions (4 floats/element)
- `instanceColor` - Colors (3 floats/element)
- `instanceVisibility` - Visibility flags (1 float/element)
- `instanceScale` - Selection highlighting (3 floats/element)

**Update Mechanism:**

```javascript
system.callUpdates(['instanceColor', 'instanceOffset'])
// Mark buffers for GPU upload on next render()
// Must call after any structural edit

// Example:
translateElements(selectedBases, new THREE.Vector3(10, 0, 0));
systems[0].callUpdates(['instanceOffset']);
render();
```

### Force Rendering

```javascript
render()
// Force Three.js repaint
// Must call after any edit operation that doesn't call it internally

// Example flow:
let strand = edit.createStrand("ATCG");
translateElements(new Set(strand.getMonomers()), new THREE.Vector3(5, 0, 0));
render();  // Required to see changes
```

---

## Event System

### Window Messaging

oxView can be embedded in iframes and controlled via `postMessage`.

**Incoming Messages:**

```javascript
// Parent → oxView
window.postMessage({
    message: 'drop',
    data: FileList
}, '*');

window.postMessage({
    message: 'download'
}, '*');
```

**Outgoing Messages:**

```javascript
// oxView → Parent
window.parent.postMessage({
    message: 'oxview_ready'
}, '*');
```

---

## Key Differences from NanoCanvas

| Feature | oxDNA-Viewer | NanoCanvas |
|---------|--------------|------------|
| **Architecture** | Electron desktop app | Web app (FastAPI backend) |
| **API Access** | Browser console (JavaScript) | REST HTTP endpoints |
| **Primary View** | 3D structure | 2D lattice (cadnano2 style) |
| **Edit Granularity** | Individual nucleotides | Strands + helices |
| **State Management** | In-memory (global variables) | Session-based (backend) |
| **Undo/Redo** | EditHistory stack (in-memory) | Backend session history |
| **ID System** | Global `id` + system-local `sid` | Auto-increment IDs per session |
| **Primary Use Case** | Visualization + structure editing | 2D design + oxDNA export |

---

## Integration Points for NanoCanvas

### Potential Sync Events

Operations in oxView that should trigger live-sync updates to NanoCanvas:

1. **edit.createStrand()** → NanoCanvas: `POST /api/sessions/{id}/strands`
2. **edit.deleteElements()** → NanoCanvas: `DELETE /api/sessions/{id}/strands/{sid}`
3. **edit.setSequence()** → NanoCanvas: `PATCH /api/sessions/{id}/strands/{sid}/sequence` (if implemented)
4. **edit.nick()** → NanoCanvas: Split strand into two
5. **edit.ligate()** → NanoCanvas: Join strands (create crossover)
6. **translateElements()** → NanoCanvas: Update helix positions
7. **colorElements()** → NanoCanvas: `PATCH /api/sessions/{id}/strands/{sid}/color`

### Recommended Approach

1. **Add Event Emitter to oxView:**
   ```javascript
   // In ts/api/editing_api.ts
   window.dispatchEvent(new CustomEvent('oxview_edit', {
       detail: {
           operation: 'createStrand',
           strandId: strand.id,
           sequence: sequence,
           position: getCOM(strand.getMonomers())
       }
   }));
   ```

2. **WebSocket Bridge:**
   - oxView emits `CustomEvent` → Electron main process captures
   - Main process → WebSocket client → NanoCanvas backend
   - Backend updates session state → Broadcasts to NanoCanvas frontend

3. **Reverse Sync (NanoCanvas → oxView):**
   - NanoCanvas API response → WebSocket → Electron → oxView window.postMessage
   - Message handler in `ts/file_handling/file_getters.ts` applies changes

---

## Example Workflows

### Create a 2-Helix Bundle with Crossover

```javascript
// Create two parallel strands
let strand1 = edit.createStrand("GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG");
let strand2 = edit.createStrand("GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG");

// Position strand2 next to strand1
let s1_monomers = new Set(strand1.getMonomers());
let s2_monomers = new Set(strand2.getMonomers());
let s1_com = api.getCOM(Array.from(s1_monomers));
translateElements(s2_monomers, new THREE.Vector3(2, 0, 0).sub(s1_com));

// Create base pairs at positions 10-20
for (let i = 10; i < 20; i++) {
    let nuc1 = strand1.getMonomers()[i];
    let nuc2 = strand2.getMonomers()[i];
    edit.createBP(nuc1, true);
}

render();
```

### Modify Existing Strand

```javascript
// Select a strand
let strand = systems[0].strands[0];
let monomers = new Set(strand.getMonomers());

// Change sequence
edit.setSequence(monomers, "AAAAAAAAGGGGGGGGTTTTTTTTCCCCCCCC", false);

// Extend 3' end
edit.extendStrand(strand.end3, "TTTTTTTT");

// Change color
colorElements(new THREE.Color(0.2, 0.8, 0.2), Array.from(monomers));

render();
```

### Create Geometric Shape

```javascript
// Create circle
let center = new THREE.Vector3(0, 0, 0);
let normal = new THREE.Vector3(0, 0, 1);  // XY plane
let circle = shapes.circle(center, normal, 5, 50);  // radius=5, 50 bases

// Tag for later reference
tagTracker.tag(circle.getMonomers(), "myCircle");

// Rotate 45°
api.rotateGroup(circle.getMonomers(), normal, 45);

render();
```

---

## Source Files

### Core API
- `ts/api/editing_api.ts` - Structure editing (1603 lines)
- `ts/api/scene_api.ts` - Visualization & queries
- `ts/api/structure_factory.ts` - Preset nanostructures (270 lines)
- `ts/api/observable_api.ts` - Dynamic observables
- `ts/api/transform_api.js` - Rotation & PCA helpers
- `ts/api/shapes_api.js` - Geometric shapes (~600 lines)
- `ts/api/llm_tracker_api.js` - Element tagging

### Data Models
- `ts/model/basicElement.ts` - Base class (105 lines)
- `ts/model/nucleotide.ts` - Nucleotide extension (308 lines)
- `ts/model/DNA.ts`, `ts/model/RNA.ts` - Type-specific classes
- `ts/model/strand.ts` - Strand container (12,203 lines)
- `ts/model/system.ts` - System + GPU instancing (22,972 lines)

### Editing
- `ts/editing/editing.ts` - Copy/paste/clipboard
- `ts/editing/doUndo.ts` - Undo/redo history
- `ts/editing/translation.ts` - Transform operations
- `ts/editing/structure_editing.ts` - UI wrappers

### UI & Rendering
- `ts/UI/UI.ts` - Notifications, keybindings
- `ts/scene/scene_setup.ts` - Three.js scene
- `ts/main.ts` - Global state, initialization (324 lines)

---

## Testing & Development

### Live Development

```bash
cd /scratch/sroy85/Github/oxdna-viewer
npm install
tsc -w & reload -b  # Auto-compile + live reload
# Open http://localhost:8080
```

### Console Testing

```javascript
// F12 → Console

// Create structure
let s = edit.createStrand("ATCGATCGATCGATCG");

// Select all
api.selectElements(s.getMonomers());

// Move
translateElements(new Set(s.getMonomers()), new THREE.Vector3(10, 0, 0));
render();

// Undo
editHistory.undo();
```

### AI Chat Testing

1. Click **AI Chat** tab in ribbon
2. Click **🤖 AI Chat** button
3. Type commands:
   - "create 20 base duplex"
   - "move the structure to position 10, 10, 10"
   - "rotate 90 degrees around Z axis"

---

## Future Extension Points

1. **REST API Layer:** Wrap console API with HTTP endpoints (similar to NanoCanvas)
2. **WebSocket Events:** Emit edit events for real-time sync
3. **Nucleotide-Level Operations:** Add individual base add/remove (currently strand-level)
4. **Session Persistence:** Save undo history + viewport state
5. **Collaborative Editing:** Multi-user via WebRTC or shared backend

---

## Related Documentation

- Full LLM agent reference: `Agents.md`
- File format specification: `file-format.md`
- Example structures: `examples/README.md`
- Original README: `README.md`
