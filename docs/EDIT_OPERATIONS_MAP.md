# Edit Operations Mapping: oxDNA-Viewer ↔ NanoCanvas

## Overview

This document maps edit operations between **oxDNA-Viewer** (3D nucleotide-level editor) and **NanoCanvas** (2D strand-level designer). The goal is to enable **bidirectional live-sync** so changes in one tool instantly reflect in the other.

**Challenge:** The platforms operate at different abstraction levels:
- **oxDNA-Viewer:** Individual nucleotides (atoms) + orientation vectors
- **NanoCanvas:** Strands (groups of nucleotides) + lattice positions

---

## Conceptual Mapping

| Concept | oxDNA-Viewer | NanoCanvas |
|---------|--------------|------------|
| **Basic Unit** | `BasicElement` (nucleotide) | `Strand` (group of nucleotides) |
| **Container** | `Strand` (linked list) | `Part` (helix-based layout) |
| **Position** | `bbOffsets` (3D vector) | `Helix{row, col}` + base index |
| **Orientation** | `rotations` (quaternion), `a1/a3` vectors | Lattice parity + direction (FORWARD/REVERSE) |
| **Connectivity** | `n3`/`n5` (backbone pointers) | `Crossover{strandId, index}` |
| **ID System** | Global `id` (0-indexed) + system-local `sid` | Auto-increment per session (`nextStrandId`) |
| **Grouping** | `System` (all structures in scene) | `Part` (single DNA design) |
| **Color** | Per-nucleotide `instanceColor` | Per-strand or per-oligo `color` |
| **State** | In-memory global variables (`elements`, `systems`) | Session-based (`CadnanoSession`) |
| **Undo/Redo** | `EditHistory` (RevertableEdit objects) | `UndoStack` (command snapshots) |

---

## Operation Mapping Table

### Create Operations

| NanoCanvas Operation | oxView Operation | Translation Notes |
|---------------------|------------------|-------------------|
| **Add Helix** | `structureFactory.createDXTile()` or manual strand | Create scaffold strand at lattice position, set parity-based direction |
| `POST /api/sessions/{id}/helices` | `edit.createStrand(sequence)` + `translateElements()` | 1. Create strand<br>2. Calculate (row, col) → 3D (x,y,z)<br>3. Move strand to position |
| `{row, col, max_bases}` | `{sequence: "G"*max_bases, position: latticeToXYZ(row, col)}` | |
| **Create Scaffold** | `edit.createStrand(seq)` + set blue color | Create FORWARD/REVERSE based on helix parity |
| `api.createScaffold(helixId, start, end)` | `edit.createStrand(seq, false, false)` + tag | helix_id % 2 == 0 → FORWARD, else REVERSE |
| **Create Staple** | `edit.createStrand(seq)` + auto-color | Opposite direction from scaffold on same helix |
| `api.createStaple(helixId, start, end, color)` | `edit.createStrand(seq)` + `colorElements()` | |
| **Create Crossover** | `edit.ligate(a, b)` | Find 3' and 5' ends at specified indices, ligate |
| `POST /api/sessions/{id}/crossovers` | `edit.ligate(strand1.getMonomers()[indexA], strand2.getMonomers()[indexB])` | Crossover = ligation between two strand endpoints |
| `{strand_id_a, index_a, strand_id_b, index_b}` | | Must validate 5'↔3' polarity |
| **Auto-Staple** | Manual staple placement | No direct equivalent - requires AI/algorithm to generate complementary strands |
| `POST /api/sessions/{id}/autostaple` | `// Complex algorithm` | NanoCanvas: graph-based scaffold traversal<br>oxView: Manual `edit.createDuplex()` + positioning |

### Delete Operations

| NanoCanvas Operation | oxView Operation | Translation Notes |
|---------------------|------------------|-------------------|
| **Remove Helix** | `edit.deleteElements(strand.getMonomers())` | Delete all strands on helix → delete all nucleotides |
| `DELETE /api/sessions/{id}/helices/{hid}` | `systems[0].strands.filter(s => s.helixId == hid).forEach(s => edit.deleteElements(s.getMonomers()))` | Cascade delete dependent strands |
| **Delete Strand** | `edit.deleteElements(strand.getMonomers())` | Direct mapping |
| `DELETE /api/sessions/{id}/strands/{sid}` | `edit.deleteElements(strand.getMonomers())` | |
| **Remove Crossover** | `edit.nick(element)` | Nick at crossover point (splits strands) |
| `DELETE /api/sessions/{id}/crossovers/{xid}` | `edit.nick(nucleotide)` | Identify nucleotide at crossover, nick backbone |

### Modify Operations

| NanoCanvas Operation | oxView Operation | Translation Notes |
|---------------------|------------------|-------------------|
| **Resize Strand** | `edit.extendStrand()` or `edit.skip()` | Extend adds nucleotides, skip removes without breaking |
| `PATCH /api/sessions/{id}/strands/{sid}/range` | `edit.extendStrand(end, seq)` (if longer)<br>`edit.skip(elements)` (if shorter) | Must handle both growth and shrinkage |
| `{start, end}` | | Compare old [start, end] with new |
| **Paint Strand** | `colorElements(color, strand.getMonomers())` | Direct color mapping |
| `PATCH /api/sessions/{id}/strands/{sid}/color` | `colorElements(new THREE.Color(r, g, b), strand.getMonomers())` | Convert hex (#rrggbb) → THREE.Color |
| `{color: "#ff6600"}` | `new THREE.Color(0xff6600)` | |
| **Set Sequence** | `edit.setSequence(elements, seq)` | Not exposed in NanoCanvas API yet |
| `// No REST endpoint` | `edit.setSequence(new Set(strand.getMonomers()), sequence, true)` | Would need `PATCH /strands/{sid}/sequence` |
| **Nick (Split)** | `edit.nick(element)` | Direct mapping |
| `// Split via resize` | `edit.nick(strand.getMonomers()[index])` | NanoCanvas splits by creating two strands |
| **Join Scaffold Rows** | `edit.ligate()` + crossover creation | Join endpoint of scaffold on helix A to helix B |
| `POST /api/sessions/{id}/join-scaffold` | `edit.ligate(scaffoldA.end3, scaffoldB.end5)` + `edit.createBP()` | May need multiple ligations for proper connection |

### Transform Operations

| NanoCanvas Operation | oxView Operation | Translation Notes |
|---------------------|------------------|-------------------|
| **Move Helix** | `translateElements(nucleotides, displacement)` | Translate all nucleotides on helix |
| `// No REST endpoint` | Calculate COM of helix strands, translate to new lattice position | Would need lattice → 3D coordinate conversion |
| **Bundle Transform** | `translateElements()` + `rotateElementsByQuaternion()` | Apply 3D transform to all helices in bundle |
| `PATCH /api/sessions/{id}/bundles/{bid}/transform` | `api.rotateGroup(elements, axis, angle)` | NanoCanvas: {x, y, z, rx, ry, rz}<br>oxView: Quaternion rotation |
| `{x, y, z, rx, ry, rz}` | Euler → Quaternion conversion required | |

---

## Data Synchronization

### ID Mapping Strategy

**Problem:** oxDNA-viewer uses global IDs (0, 1, 2, ...) while NanoCanvas uses session-scoped IDs per entity type (strandId=0, helixId=0 can coexist).

**Solution:** Maintain a **bidirectional mapping table**:

```javascript
{
  oxview_to_nc: {
    system_0: {
      strand_5: { type: "strand", nc_id: 12, helix_id: 1 },
      strand_6: { type: "strand", nc_id: 13, helix_id: 1 },
      // ...
    }
  },
  nc_to_oxview: {
    helix_0: { system_id: 0, strand_ids: [1, 2, 3, 4] },  // All strands on helix
    strand_12: { system_id: 0, strand_id: 5 },
    strand_13: { system_id: 0, strand_id: 6 },
    // ...
  }
}
```

### Initial Sync (Load Design)

**NanoCanvas → oxDNA-Viewer:**

1. Export cadnano v2 JSON from NanoCanvas (`GET /api/sessions/{id}/export/v2`)
2. Convert to oxDNA format via tacoxDNA (`POST /convert/cadnano-to-oxdna`)
3. Load `.dat` + `.top` into oxDNA-viewer (`handleFiles()`)
4. Build ID mapping by traversing:
   - NanoCanvas helices → oxView systems[0].strands (match by position + sequence)
   - NanoCanvas strands → oxView strand objects (match by helix + start/end indices)
   - NanoCanvas crossovers → oxView ligations (match by connected strand pairs)

**oxDNA-Viewer → NanoCanvas:**

1. Export oxDNA files from viewer (`makeOutputFiles()`)
2. Parse `.top` + `.dat` on NanoCanvas backend
3. Infer 2D lattice layout:
   - Project 3D nucleotide positions onto plane (PCA or user-specified axis)
   - Grid-snap to nearest hex/square lattice coordinates
   - Group consecutive nucleotides into strands
4. Detect crossovers from base-pairing + backbone connectivity
5. Create Part model with inferred helices/strands/crossovers
6. Build reverse ID mapping

### Live Sync Events

**Event Flow:**

```
User edits in NanoCanvas
    ↓
NanoCanvas API call (e.g. POST /api/sessions/{id}/strands)
    ↓
Backend updates session state
    ↓
Emit WebSocket event: { operation: "createStrand", data: {...} }
    ↓
WebSocket bridge forwards to oxDNA-viewer
    ↓
oxView event handler receives message
    ↓
Translate to oxView operation (e.g. edit.createStrand())
    ↓
Apply operation + render()
    ↓
Update ID mapping table
```

**Reverse Flow (oxView → NanoCanvas):**

```
User edits in oxDNA-viewer (e.g. edit.createStrand())
    ↓
Emit CustomEvent('oxview_edit', {detail: {...}})
    ↓
Electron main process captures event
    ↓
Send WebSocket message to NanoCanvas backend
    ↓
Backend translates to NanoCanvas operation
    ↓
Execute command (e.g. CreateStrandCommand)
    ↓
Broadcast state update to NanoCanvas frontend
    ↓
Frontend re-renders
    ↓
Update ID mapping table
```

---

## Translation Functions

### Lattice Coordinates ↔ 3D Positions

**NanoCanvas → oxView:**

```javascript
function latticeToOxView(row, col, latticeType) {
  // Use NanoCanvas lattice transform
  const { x, y } = latticeCoordToXY(row, col, latticeType);

  // Map to oxView 3D space (Z=0 plane)
  // Scale factor: NanoCanvas uses normalized coords, oxView uses nanometers
  const SCALE = 2.5;  // nm per lattice unit (configurable)
  return new THREE.Vector3(x * SCALE, y * SCALE, 0);
}
```

**oxView → NanoCanvas:**

```javascript
function oxViewToLattice(position, latticeType) {
  // Project to XY plane (ignore Z or use PCA)
  const x = position.x / SCALE;
  const y = position.y / SCALE;

  // Grid-snap to nearest lattice position
  return nearestLatticeCoord(x, y, latticeType);
}

function nearestLatticeCoord(x, y, latticeType) {
  // Brute-force search within reasonable bounds
  let minDist = Infinity;
  let best = { row: 0, col: 0 };

  for (let row = -50; row <= 50; row++) {
    for (let col = -50; col <= 50; col++) {
      const { x: gx, y: gy } = latticeCoordToXY(row, col, latticeType);
      const dist = Math.hypot(x - gx, y - gy);
      if (dist < minDist) {
        minDist = dist;
        best = { row, col };
      }
    }
  }

  return best;
}
```

### Direction & Parity

**NanoCanvas parity rules:**
```javascript
// Even helix IDs → scaffold on top (FORWARD)
// Odd helix IDs → scaffold on bottom (REVERSE)
const scaffoldDirection = (helixId % 2 === 0) ? FORWARD : REVERSE;
```

**oxView strand direction:**
```typescript
// Stored as n3/n5 pointers (linked list)
// Direction inferred from 5' → 3' traversal
const isForward = (strand.end5.getPos().y < strand.end3.getPos().y);
```

**Translation:**
- NanoCanvas `direction: 1` → oxView FORWARD (5' at lower Y)
- NanoCanvas `direction: -1` → oxView REVERSE (5' at higher Y)
- Requires consistent Y-axis orientation convention

### Sequence Translation

Both platforms use uppercase ATGCU:
- DNA: A, T, G, C
- RNA: A, U, G, C

**NanoCanvas:** Stores sequence implicitly (reconstructed from scaffold traversal + staple assignments)
**oxView:** Stores per-nucleotide `type` field

**Export NanoCanvas → oxView:**
```python
# In tacoxDNA cadnano → oxDNA converter
for strand in part.strands:
    sequence = strand.getSequence()  # From v2 JSON scaffold/staple arrays
    for i, base in enumerate(sequence):
        nucleotide.type = base
```

**Export oxView → NanoCanvas:**
```javascript
function extractSequence(strand) {
  return strand.getMonomers().map(e => e.type).join('');
}
```

---

## Sync Conflict Resolution

### Concurrent Edits

**Problem:** User edits in both tools simultaneously (unlikely with single-user, but possible with multi-user setup).

**Strategy:** Last-write-wins with conflict detection:

1. Each edit event includes a `timestamp` and `sessionId`
2. Backend maintains a `last_update` timestamp per entity (helix, strand, crossover)
3. If incoming edit timestamp < last_update, reject or prompt user

**Example:**
```javascript
{
  operation: "setStrandRange",
  strand_id: 12,
  new_range: [0, 40],
  timestamp: 1781326800000,
  session_id: "nano_user1"
}
```

If `strands[12].last_update > 1781326800000`, emit conflict warning.

### Operational Transform (Advanced)

For true multi-user collaboration, use **Operational Transformation** (OT):
- Each operation encodes its intent (e.g., "extend strand by 5 bases")
- Conflicting operations are transformed based on causal order
- Example: User A extends strand [0, 30] → [0, 35], User B extends [0, 30] → [0, 32]
  - Result: [0, 37] (both extensions applied)

Libraries: ShareDB, Yjs, Automerge (CRDT)

---

## Implementation Phases

### Phase 1: One-Way Sync (NanoCanvas → oxView)

**Minimal viable sync:**

1. Add WebSocket endpoint to NanoCanvas backend:
   ```python
   @app.websocket("/ws/sync/{session_id}")
   async def sync_websocket(websocket: WebSocket, session_id: str):
       await websocket.accept()
       # Subscribe to session updates
       # On any API call, broadcast event
   ```

2. Add WebSocket client to Electron main process (oxView):
   ```javascript
   const ws = new WebSocket('ws://localhost:8765/ws/sync/default');
   ws.on('message', (data) => {
       const event = JSON.parse(data);
       // Forward to renderer process
       mainWindow.webContents.send('nc-sync-event', event);
   });
   ```

3. Add event handler in oxView renderer (`ts/file_handling/file_getters.ts`):
   ```typescript
   window.addEventListener('nc-sync-event', (event) => {
       handleNanoCanvasSync(event.detail);
   });

   function handleNanoCanvasSync(event) {
       switch (event.operation) {
           case 'createStrand':
               const seq = "G".repeat(event.data.end - event.data.start);
               const strand = edit.createStrand(seq);
               const pos = latticeToOxView(event.data.helix_row, event.data.helix_col, event.data.lattice_type);
               translateElements(new Set(strand.getMonomers()), pos);
               render();
               break;
           case 'deleteStrand':
               const oxStrand = idMap.nc_to_oxview[`strand_${event.data.strand_id}`];
               edit.deleteElements(oxStrand.getMonomers());
               render();
               break;
           // ... other operations
       }
   }
   ```

### Phase 2: Two-Way Sync (Bidirectional)

1. Add event emitters to oxView editing API:
   ```typescript
   // In ts/api/editing_api.ts
   export function createStrand(sequence, createDuplex, isRNA) {
       const strand = /* ... create strand logic ... */;

       // Emit sync event
       window.dispatchEvent(new CustomEvent('oxview_edit', {
           detail: {
               operation: 'createStrand',
               strand_id: strand.id,
               sequence: sequence,
               position: getCOM(strand.getMonomers()),
               timestamp: Date.now()
           }
       }));

       return strand;
   }
   ```

2. Electron main process captures and forwards to NanoCanvas:
   ```javascript
   ipcMain.on('oxview_edit', (event, data) => {
       ws.send(JSON.stringify(data));
   });
   ```

3. NanoCanvas backend applies reverse translation:
   ```python
   async def handle_oxview_sync(event: dict):
       if event['operation'] == 'createStrand':
           helix_pos = oxview_to_lattice(event['position'], part.lattice_type)
           # Find or create helix at position
           helix_id = get_or_create_helix(helix_pos['row'], helix_pos['col'])
           # Create strand
           strand_id = session.create_strand(helix_id, direction=1, start=0, end=len(event['sequence']))
           # Update ID mapping
   ```

### Phase 3: ID Mapping Persistence

Store mapping in a shared database or file:

```json
{
  "session_id": "default",
  "last_sync": "2026-06-12T22:00:00Z",
  "mappings": {
    "helix_0": {
      "oxview": { "system_id": 0, "strands": [5, 6, 7] },
      "nanocanvas": { "helix_id": 0 }
    },
    "strand_12": {
      "oxview": { "system_id": 0, "strand_id": 5 },
      "nanocanvas": { "strand_id": 12, "helix_id": 0 }
    }
  }
}
```

---

## Testing Strategy

1. **Unit Tests:** Test translation functions (latticeToOxView, oxViewToLattice, direction mapping)
2. **Integration Tests:**
   - Create strand in NanoCanvas → Verify appears in oxView
   - Delete strand in oxView → Verify disappears in NanoCanvas
   - Create crossover in NanoCanvas → Verify ligation in oxView
3. **End-to-End Tests:**
   - Design a 4-helix bundle in NanoCanvas
   - Switch to oxView, verify 3D structure matches
   - Edit in oxView (move helix), verify updates in NanoCanvas
4. **Conflict Tests:**
   - Simultaneous edits in both tools
   - Verify last-write-wins or OT resolution

---

## Open Questions

1. **3D Orientation:** How to preserve oxView's full 3D rotations when projecting to NanoCanvas 2D lattice?
   - Option A: Store rotation metadata in NanoCanvas Part (not visible in UI)
   - Option B: Only sync position, lose rotation info

2. **Multi-System Support:** oxView can load multiple Systems. NanoCanvas uses single Part per session.
   - Option A: Map each oxView System to a separate NanoCanvas session
   - Option B: Merge all Systems into one Part (may cause ID collisions)

3. **Undo/Redo Sync:** Should undo in one tool trigger undo in the other?
   - Option A: Sync undo/redo operations (complex, may desync stacks)
   - Option B: Independent undo stacks (simpler, but may confuse users)

4. **Real-Time Performance:** With 1000+ nucleotides, is WebSocket sync fast enough?
   - Solution: Batch updates, debounce (wait 100ms after last edit before syncing)

---

## Summary

| Aspect | Approach |
|--------|----------|
| **ID Mapping** | Bidirectional lookup table (oxview_to_nc, nc_to_oxview) |
| **Position Sync** | Lattice coords ↔ 3D vectors via scale factor (2.5 nm/unit) |
| **Direction Sync** | NanoCanvas parity rules → oxView n3/n5 linked list |
| **Communication** | WebSocket (NanoCanvas FastAPI ↔ Electron main process) |
| **Conflict Resolution** | Last-write-wins with timestamp checks |
| **Testing** | Unit (translation) + Integration (CRUD operations) + E2E (full workflows) |

**Next Steps:**
1. Implement Phase 1 (one-way sync NanoCanvas → oxView)
2. Test with simple 2-helix bundle
3. Add reverse sync (Phase 2)
4. Build ID mapping persistence (Phase 3)
5. Optimize for real-time performance
