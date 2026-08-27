# oxDNA-Viewer + NanoCanvas Integration Guide

## Overview

This guide explains how to use the live bidirectional synchronization between **oxDNA-Viewer** (3D DNA structure editor) and **NanoCanvas** (2D DNA origami CAD tool).

**Key Features:**
- Real-time synchronization via WebSocket
- Bidirectional ID mapping (3D atoms ↔ 2D lattice coordinates)
- Support for all editing operations (create, delete, modify)
- Automatic coordinate transformation
- Undo/redo sync across both platforms

---

## Architecture

```
┌─────────────────┐          WebSocket          ┌──────────────────┐
│  oxDNA-Viewer   │◄────────────────────────────►│   NanoCanvas     │
│   (3D Client)   │        ws://localhost:8765   │   (2D Server)    │
└─────────────────┘                              └──────────────────┘
        │                                                   │
        │                                                   │
   ┌────▼────┐                                        ┌────▼────┐
   │ ncSync  │                                        │ FastAPI │
   │   API   │                                        │ /ws endpoint │
   └────┬────┘                                        └────┬────┘
        │                                                   │
   ┌────▼────┐                                        ┌────▼────┐
   │ IDMapper│                                        │ Session │
   │         │                                        │  State  │
   └─────────┘                                        └─────────┘
```

**Components:**
1. **ID Mapping Layer** (`ts/api/id_mapping.ts`) - Bidirectional lookup tables
2. **NanoCanvas Sync API** (`ts/api/nanocanvas_sync_api.ts`) - High-level operations
3. **WebSocket Sync** (`ts/api/websocket_sync.ts`) - oxView client
4. **WebSocket Server** (`backend/websocket_sync.py`) - NanoCanvas endpoint

---

## Installation

### Prerequisites

1. **oxDNA-Viewer** (Electron app)
   ```bash
   cd /path/to/oxdna-viewer
   npm install
   npm run build
   ```

2. **NanoCanvas Backend**
   ```bash
   cd /path/to/NanoCanvas/backend
   pip install fastapi uvicorn websockets
   ```

3. **NanoCanvas Frontend**
   ```bash
   cd /path/to/NanoCanvas
   npm install
   npm run dev
   ```

### Start Services

1. **Start NanoCanvas Backend** (Terminal 1):
   ```bash
   cd NanoCanvas/backend
   uvicorn app:app --host 0.0.0.0 --port 8765 --reload
   ```
   Should see:
   ```
   INFO:     Uvicorn running on http://0.0.0.0:8765
   INFO:     WebSocket server ready at ws://localhost:8765/ws
   ```

2. **Start NanoCanvas Frontend** (Terminal 2):
   ```bash
   cd NanoCanvas
   npm run dev
   ```
   Opens at `http://localhost:5173`

3. **Open Integration Interface** (Browser):
   ```
   file:///path/to/oxdna-viewer/integration/nanocanvas_embed.html
   ```

---

## Usage Guide

### Method 1: Integrated Interface (Recommended)

Open `integration/nanocanvas_embed.html` in a modern browser:

**Features:**
- Split-screen view (3D on left, 2D on right)
- Draggable divider to resize panels
- Sync controls at bottom:
  - **Sync 3D → 2D**: Export oxView state to NanoCanvas
  - **Sync 2D → 3D**: Import NanoCanvas state to oxView
  - **Enable Live Sync**: Start bidirectional real-time sync
  - **Stop Sync**: Pause synchronization
  - **Export State**: Download combined state as JSON

**Status Indicators:**
- 🟢 Green dot = Connected and synced
- 🟠 Orange dot = Syncing in progress
- 🔴 Red dot = Connection error
- ⚫ Gray dot = Disconnected

### Method 2: Standalone Usage

#### In oxDNA-Viewer Console

1. **Initialize WebSocket Sync**
   ```javascript
   wsSync.initialize('ws://localhost:8765/ws');
   ```

2. **Create a Helix at Lattice Position**
   ```javascript
   const result = ncSync.createHelix(
       row = 5,
       col = 10,
       maxBases = 32,
       helixId = 1
   );
   // Returns: { elements: [...], helixId: 1 }
   ```

3. **Create a Strand on Helix**
   ```javascript
   const strand = ncSync.createStrand(
       helixId = 1,
       direction = 1,        // FORWARD (5' → 3')
       startIndex = 0,
       endIndex = 16,
       color = "#0066cc",
       strandId = 100
   );
   ```

4. **Create a Crossover**
   ```javascript
   ncSync.createCrossover(
       helixIdA = 1, directionA = 1, indexA = 15,
       helixIdB = 2, directionB = -1, indexB = 15
   );
   ```

5. **Add/Remove Single Nucleotide**
   ```javascript
   // Add
   const elem = ncSync.addNucleotide(helixId = 1, direction = 1, index = 20, baseType = 'A');

   // Remove
   ncSync.removeNucleotide(helixId = 1, direction = 1, index = 20);
   ```

6. **Export Current State**
   ```javascript
   const state = ncSync.exportSyncState();
   console.log(state);
   ```

7. **Import from NanoCanvas**
   ```javascript
   fetch('http://localhost:8765/api/sessions/default')
       .then(r => r.json())
       .then(state => ncSync.importFromNanoCanvas(state));
   ```

#### In NanoCanvas Python Client

```python
from websockets import connect
import json

async def sync_example():
    uri = "ws://localhost:8765/ws"
    async with connect(uri) as websocket:
        # Request current state
        await websocket.send(json.dumps({
            "type": "request_state",
            "source": "python_client",
            "timestamp": int(time.time() * 1000)
        }))

        # Receive state
        response = await websocket.recv()
        data = json.loads(response)
        print(data)

        # Create helix
        await websocket.send(json.dumps({
            "type": "helix_created",
            "source": "python_client",
            "data": {
                "row": 3,
                "col": 4,
                "max_bases": 32
            }
        }))
```

---

## API Reference

### ID Mapper (`idMapper`)

```typescript
// Convert lattice to 3D position
const pos: THREE.Vector3 = idMapper.latticeToPosition(row, col);

// Convert 3D position to lattice
const lattice = idMapper.positionToLattice(pos);
// Returns: { row, col, lattice_type }

// Look up NanoCanvas coordinate from oxView element ID
const ncCoord = idMapper.getNCCoord(elementId);
// Returns: { helix_id, direction, index }

// Look up oxView element ID from NanoCanvas coordinate
const oxId = idMapper.getOxViewId(helixId, direction, index);
// Returns: { element_id, strand_id, system_id }

// Get statistics
const stats = idMapper.getStats();
// Returns: { total_mappings, unique_helices, unique_strands, lattice_type }

// Export/import mappings
const json = idMapper.exportMappings();
idMapper.importMappings(json);
```

### NanoCanvas Sync API (`ncSync`)

**Helix Operations:**
```typescript
ncSync.createHelix(row, col, maxBases?, helixId?);
ncSync.removeHelix(helixId);
```

**Strand Operations:**
```typescript
ncSync.createStrand(helixId, direction, startIndex, endIndex, color?, strandId?);
ncSync.deleteStrand(strandId);
```

**Crossover Operations:**
```typescript
ncSync.createCrossover(helixIdA, directionA, indexA, helixIdB, directionB, indexB);
ncSync.removeCrossover(helixId, direction, index);
```

**Nucleotide Operations:**
```typescript
ncSync.addNucleotide(helixId, direction, index, baseType = 'A');
ncSync.removeNucleotide(helixId, direction, index);
ncSync.changeBaseType(helixId, direction, index, newType);
```

**State Management:**
```typescript
ncSync.getHelixState();      // Returns array of helix objects
ncSync.getStrandState();     // Returns array of strand objects
ncSync.exportSyncState();    // Returns JSON string
ncSync.importFromNanoCanvas(state);  // Reconstruct from NC state
```

### WebSocket Sync (`wsSync`)

```typescript
// Connect to NanoCanvas
wsSync.initialize('ws://localhost:8765/ws');

// Disconnect
wsSync.disconnect();

// Check status
const status = wsSync.getStatus();
// Returns: { connected, url, queued_messages }

// Request sync from NanoCanvas
wsSync.requestSync();

// Push current state to NanoCanvas
wsSync.pushState();
```

### WebSocket Events

**Events emitted by ncSync (forwarded to NanoCanvas):**
- `helix_created` - New helix added
- `helix_removed` - Helix deleted
- `strand_created` - New strand added
- `strand_deleted` - Strand deleted
- `crossover_created` - Crossover added
- `crossover_removed` - Crossover deleted
- `nucleotide_added` - Single nucleotide added
- `nucleotide_removed` - Single nucleotide deleted
- `base_type_changed` - Base type modified

**Event structure:**
```javascript
{
    type: "helix_created",
    source: "oxview" | "nanocanvas",
    timestamp: 1234567890,
    data: { /* operation-specific data */ }
}
```

---

## Coordinate Systems

### Lattice Types

1. **Honeycomb Lattice** (default)
   - Hexagonal packing
   - X spacing: 2.5 nm
   - Y spacing: 2.1651 nm (√3 × 1.25)
   - Every other row offset by X/2

2. **Square Lattice**
   - Grid packing
   - X spacing: 2.5 nm
   - Y spacing: 2.5 nm

### Conventions

**NanoCanvas:**
- Helix ID: Auto-incrementing integer
- Direction: `1` (FORWARD 5'→3') or `-1` (REVERSE 3'→5')
- Index: Base position along helix (0-indexed)
- Parity rule: Even helix IDs → scaffold FORWARD, Odd → scaffold REVERSE

**oxDNA-Viewer:**
- Element ID: Global unique ID for each nucleotide
- Strand ID: Unique ID for each continuous strand
- 3D Position: (x, y, z) in nanometers
- Z-axis: Helix axis (rise = 0.34 nm/base)

---

## Troubleshooting

### WebSocket Won't Connect

**Error:** `WebSocket connection failed`

**Solutions:**
1. Check NanoCanvas backend is running:
   ```bash
   curl http://localhost:8765/api/sessions
   ```
   Should return session data.

2. Verify WebSocket endpoint:
   ```bash
   wscat -c ws://localhost:8765/ws
   ```
   Should connect and receive `{"type":"connected"}`.

3. Check firewall/CORS settings in `backend/app.py`:
   ```python
   allow_origins=["http://localhost:5173", ...]
   ```

### IDs Not Mapping Correctly

**Symptom:** Created elements don't appear in the other view

**Solutions:**
1. Check ID mapper statistics:
   ```javascript
   console.log(idMapper.getStats());
   ```

2. Export and inspect mappings:
   ```javascript
   console.log(idMapper.exportMappings());
   ```

3. Verify helix was created before strand:
   ```javascript
   ncSync.createHelix(0, 0, 32, 1);  // Must exist first
   ncSync.createStrand(1, 1, 0, 16);  // Then create strand on helix 1
   ```

### Sync Events Not Received

**Symptom:** Changes in one view don't update the other

**Solutions:**
1. Check WebSocket status:
   ```javascript
   console.log(wsSync.getStatus());
   ```

2. Verify live sync is enabled:
   ```javascript
   wsSync.initialize();  // Re-initialize if needed
   ```

3. Check browser console for errors

4. Test with manual sync:
   ```javascript
   wsSync.requestSync();  // Pull from NanoCanvas
   wsSync.pushState();    // Push to NanoCanvas
   ```

### Performance Issues

**Symptom:** Lag when creating many elements

**Solutions:**
1. Disable live sync during bulk operations:
   ```javascript
   wsSync.disconnect();
   // ... create many elements ...
   wsSync.initialize();
   wsSync.pushState();  // Sync once at end
   ```

2. Use batch operations where possible:
   ```javascript
   // Instead of many addNucleotide calls:
   ncSync.createStrand(helixId, direction, start, end);
   ```

---

## Testing

### Run ID Mapping Tests

Open in browser:
```
file:///path/to/oxdna-viewer/tests/test_id_mapping.html
```

Click "Run All Tests" - should show 13 passing tests.

### Run Integration Tests

```bash
cd oxdna-viewer/tests

# Make sure NanoCanvas backend is running first!
python3 integration_test.py --url ws://localhost:8765/ws
```

Expected output:
```
============================================================
oxDNA-Viewer + NanoCanvas Integration Test Suite
============================================================

✓ WebSocket connection
✓ Connection confirmation
✓ Request state
✓ Create helix
✓ Create strand
✓ Message round-trip
✓ Error handling
✓ Concurrent messages

============================================================
Test Summary
============================================================
Total Tests:  8
Passed:       8
Failed:       0
Pass Rate:    100.0%

✓ All tests passed!
```

---

## Example Workflows

### Workflow 1: Import cadnano Design to 3D

```javascript
// 1. Load design in NanoCanvas (via UI or API)
// 2. In oxView console, import the state:
fetch('http://localhost:8765/api/sessions/default')
    .then(r => r.json())
    .then(state => {
        ncSync.importFromNanoCanvas(state);
        camera.centerView();  // Center camera on new structure
    });
```

### Workflow 2: Design in 3D, Export to 2D CAD

```javascript
// 1. Create structures in oxView
edit.createStrand('ATCGATCGATCGATCG', true);  // Create duplex

// 2. Export to NanoCanvas
wsSync.pushState();

// 3. In NanoCanvas, refine 2D layout and auto-staple
```

### Workflow 3: Real-Time Collaborative Editing

1. Open integration interface
2. Click "Enable Live Sync"
3. Edit in either view - changes appear in both
4. Use "Export State" to save combined design

---

## Advanced Usage

### Custom Event Listeners

```typescript
// Listen for specific events
ncSync.addEventListener('helix_created', (event) => {
    console.log('Helix created:', event.data);
    // Custom logic here
});

// Listen for all events
ncSync.addEventListener('*', (event) => {
    console.log('Event:', event.type, event.data);
});
```

### Manual ID Mapping

```typescript
// Add custom mapping
idMapper.addMapping(
    elementId = 12345,
    strandId = 1,
    systemId = 0,
    helixId = 5,
    direction = 1,
    index = 10,
    row = 2,
    col = 3,
    position3d = new THREE.Vector3(5, 4.33, 3.4)
);

// Query mapping
const ncCoord = idMapper.getNCCoord(12345);
console.log(`Helix: ${ncCoord.helix_id}, Index: ${ncCoord.index}`);
```

### Lattice Coordinate Calculations

```typescript
// Get 3D position for a base on a helix
const pos = idMapper.helixIndexToPosition(
    row = 5,
    col = 10,
    index = 20  // 20th base along helix
);
// Returns: Vector3(lattice_x, lattice_y, 20 * 0.34)

// Find nearest lattice position for an element
const elem = elements.get(someId);
const lattice = idMapper.positionToLattice(elem.getPos());
console.log(`Lattice: (${lattice.row}, ${lattice.col})`);
```

---

## Known Limitations

1. **Sequence Sync**: Currently only positions/topology sync, not full sequences
2. **Circular Strands**: Circular scaffold strands may not sync correctly
3. **Large Structures**: Designs with >10,000 nucleotides may have performance issues
4. **Undo/Redo**: Cross-platform undo/redo is experimental

---

## Contributing

To add new sync operations:

1. **Add operation to `nanocanvas_sync_api.ts`**:
   ```typescript
   export function newOperation(params) {
       // ... implement operation ...
       emitEvent({ type: 'new_operation', data: { ... } });
   }
   ```

2. **Add handler to `websocket_sync.ts`**:
   ```typescript
   function handleNewOperation(data) {
       ncSync.newOperation(data.param1, data.param2);
   }
   ```

3. **Add backend handler to `websocket_sync.py`**:
   ```python
   elif msg_type == "new_operation":
       # Handle in session
       session.new_operation(data["param1"])
   ```

4. **Add test to `integration_test.py`**:
   ```python
   async def test_new_operation(self):
       # Test implementation
   ```

---

## Support

- **Documentation**: See `docs/OXDNA_VIEWER_API.md`, `docs/NANOCANVAS_API.md`, `docs/EDIT_OPERATIONS_MAP.md`
- **Issues**: Report bugs in respective GitHub repos
- **Examples**: Check `tests/` directory for usage examples
