# NanoCanvas API Documentation

## Overview

NanoCanvas is a React + Three.js 2D DNA origami design tool (cadnano2-inspired) with a comprehensive REST API for programmatic control. It exposes both a **FastAPI backend** (Python) and a **browser-side JavaScript API** for LLM agents and automation.

**Tech Stack:**
- Frontend: React + Three.js + Vite
- Backend: FastAPI (Python) + tacoxDNA
- State Management: Session-based with undo/redo

---

## Architecture

### Two API Layers

1. **Backend REST API** (`/api/*`)
   - Stateful session management
   - CRUD operations for helices, strands, crossovers
   - Export to oxDNA, cadnano v2, CSV
   - Runs on `http://localhost:8765` by default

2. **Browser JavaScript API** (`window.__CADNANO_AI__`)
   - Synchronous wrapper around REST API
   - Direct manipulation from browser console
   - Used by built-in LLM agent panel

---

## Backend REST API

### Base URL
```
http://localhost:8765
```

### Session Management

**Default session:** `session_id=default` (no need to create)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List all sessions |
| `/api/sessions` | POST | Create new session `{name, lattice_type}` |
| `/api/sessions/{id}` | GET | Get full session state |
| `/api/sessions/{id}` | DELETE | Delete session |
| `/api/sessions/{id}/reset` | POST | Clear document `{name, lattice_type?}` |
| `/api/sessions/{id}/load` | POST | Load state `{state}` |
| `/api/sessions/{id}/undo` | POST | Undo last operation |
| `/api/sessions/{id}/redo` | POST | Redo last undone operation |

### Helices

| Endpoint | Method | Description | Request Body | Response |
|----------|--------|-------------|--------------|----------|
| `/api/sessions/{id}/helices` | GET | List all helices | - | `{helices: [{id, row, col, ...}]}` |
| `/api/sessions/{id}/helices` | POST | Add helix | `{row, col, max_bases?}` | `{...state, helixId}` |
| `/api/sessions/{id}/helices/{hid}` | DELETE | Remove helix | - | Updated state |

**Example:**
```python
# Add helix at position (0, 0)
POST /api/sessions/default/helices
{
  "row": 0,
  "col": 0,
  "max_bases": 32
}
# Returns: {...state, "helixId": 0}
```

### Strands

| Endpoint | Method | Description | Request Body | Response |
|----------|--------|-------------|--------------|----------|
| `/api/sessions/{id}/strands` | GET | List all strands | - | `{strands: [{id, helix_id, ...}]}` |
| `/api/sessions/{id}/strands` | POST | Create strand | `{helix_id, direction, start, end, color?}` | `{...state, strandId}` |
| `/api/sessions/{id}/strands/{sid}` | DELETE | Delete strand | - | Updated state |
| `/api/sessions/{id}/strands/{sid}/range` | PATCH | Modify strand range | `{start, end}` | Updated state |
| `/api/sessions/{id}/strands/{sid}/color` | PATCH | Paint strand | `{color}` | Updated state |

**Direction:**
- `1` = FORWARD (5' → 3')
- `-1` = REVERSE (3' → 5')

**Convention:**
- Even helix IDs (0, 2, 4, ...) → scaffold on FORWARD lane
- Odd helix IDs (1, 3, 5, ...) → scaffold on REVERSE lane

**Example:**
```python
# Create scaffold strand
POST /api/sessions/default/strands
{
  "helix_id": 0,
  "direction": 1,      # FORWARD (even helix)
  "start": 0,
  "end": 32,
  "color": "#0066cc"   # Blue for scaffold
}

# Create staple strand
POST /api/sessions/default/strands
{
  "helix_id": 0,
  "direction": -1,     # REVERSE (opposite of scaffold)
  "start": 10,
  "end": 20
}
```

### Crossovers

| Endpoint | Method | Description | Request Body | Response |
|----------|--------|-------------|--------------|----------|
| `/api/sessions/{id}/crossovers` | GET | List all crossovers | - | `{crossovers: [...]}` |
| `/api/sessions/{id}/crossovers` | POST | Create crossover | `{strand_id_a, index_a, strand_id_b, index_b}` | `{...state, crossoverId}` |
| `/api/sessions/{id}/crossovers/{cid}` | DELETE | Remove crossover | - | Updated state |

### High-Level Operations

| Endpoint | Method | Description | Request Body |
|----------|--------|-------------|--------------|
| `/api/sessions/{id}/autostaple` | POST | Auto-generate staple topology | - |
| `/api/sessions/{id}/join-scaffold` | POST | Join scaffold across two helices | `{helix_id_a, helix_id_b}` |

### Export

| Endpoint | Method | Description | Response |
|----------|--------|-------------|----------|
| `/api/sessions/{id}/export/v2` | GET | Export cadnano v2 JSON | JSON dict |
| `/api/sessions/{id}/export/staples-csv` | GET | Export staples CSV | CSV text |
| `/api/sessions/{id}/export/oxdna` | POST | Export to oxDNA (.dat + .top) | ZIP file |

---

## Python Client (LLM/Agent API)

Located at: `LLM/api_client.py`

### Installation
```bash
cd LLM
pip install -r requirements.txt
```

### Usage

```python
from api_client import NanoCanvasClient

client = NanoCanvasClient()  # Connects to http://localhost:8765
client.reset(lattice_type="square")

# Add helices
client.add_helix(row=0, col=0)
client.add_helix(row=0, col=1)

# Create scaffold
client.create_scaffold(helix_id=0, start=0, end=32)
client.create_scaffold(helix_id=1, start=0, end=32)

# Join with crossover
client.join_scaffold(helix_id_a=0, helix_id_b=1)

# Auto-generate staples
client.auto_staple()

# Get state
state = client.get_state()
print(f"Helices: {len(state['helices'])}, Strands: {len(state['strands'])}")

# Export
v2_json = client.export_v2()
oxdna_zip = client.export_oxdna()
```

### Client Methods

#### Session Management
- `client.get_state()` → Full session state
- `client.reset(name?, lattice_type?)` → Clear document
- `client.load(state)` → Load from JSON
- `client.undo()` / `client.redo()`

#### Helices
- `client.add_helix(row, col, max_bases=32)` → Returns `{...state, helixId}`
- `client.remove_helix(helix_id)`
- `client.list_helices()` → `[{id, row, col, ...}]`

#### Strands
- `client.create_strand(helix_id, direction, start, end, color?)`
- `client.create_scaffold(helix_id, start=0, end=32)` → Auto-detects direction
- `client.create_staple(helix_id, start, end, color?)` → Auto-detects direction
- `client.delete_strand(strand_id)`
- `client.set_strand_range(strand_id, start, end)`
- `client.paint_strand(strand_id, color)`
- `client.list_strands()` → `[{id, helix_id, direction, ...}]`

#### Crossovers
- `client.create_crossover(strand_id_a, index_a, strand_id_b, index_b)`
- `client.remove_crossover(crossover_id)`
- `client.list_crossovers()`

#### High-Level
- `client.auto_staple()` → Auto-generate staples
- `client.join_scaffold(helix_id_a, helix_id_b)` → Place + connect

#### Export
- `client.export_v2()` → cadnano v2 JSON
- `client.export_staples_csv()` → CSV text
- `client.export_oxdna()` → ZIP bytes

---

## Browser JavaScript API

Exposed as `window.__CADNANO_AI__` when the AI Agent panel is active.

### Methods (same interface as Python client)

```javascript
const api = window.__CADNANO_AI__;

api.reset({ latticeType: 'square', name: 'My Design' });
api.addHelix({ row: 0, col: 0 });
api.createScaffold(0, 0, 32);
api.autoStaple();
api.undo();

// Constants
api.FORWARD  // 1
api.REVERSE  // -1

// Get current state
const state = api.snapshot();
const summary = api.summary();  // Human-readable description

// Export
const v2Json = api.exportV2();
```

---

## Data Model

### Session State

```typescript
{
  id: string;
  name: string;
  latticeType: "square" | "honeycomb";
  helices: Helix[];
  strands: Strand[];
  crossovers: Crossover[];
  stats: {
    helixCount: number;
    strandCount: number;
    crossoverCount: number;
  };
}
```

### Helix

```typescript
{
  id: number;
  row: number;        // Lattice row
  col: number;        // Lattice column
  max_bases: number;  // Length (default 32)
}
```

### Strand

```typescript
{
  id: number;
  helix_id: number;
  direction: 1 | -1;  // FORWARD | REVERSE
  start: number;      // Base index
  end: number;        // Base index
  color: string;      // Hex color
}
```

### Crossover

```typescript
{
  id: number;
  strand_id_a: number;
  index_a: number;     // Base index on strand A
  strand_id_b: number;
  index_b: number;     // Base index on strand B
}
```

---

## Edit Operations Summary

| Operation | REST Endpoint | Client Method | Description |
|-----------|---------------|---------------|-------------|
| **Add Helix** | `POST /api/sessions/{id}/helices` | `add_helix(row, col)` | Add helix at grid position |
| **Remove Helix** | `DELETE /api/sessions/{id}/helices/{hid}` | `remove_helix(helix_id)` | Delete helix + all strands on it |
| **Create Strand** | `POST /api/sessions/{id}/strands` | `create_strand(...)` | Add strand on helix |
| **Delete Strand** | `DELETE /api/sessions/{id}/strands/{sid}` | `delete_strand(strand_id)` | Remove strand |
| **Modify Strand Range** | `PATCH /api/sessions/{id}/strands/{sid}/range` | `set_strand_range(...)` | Change start/end indices |
| **Paint Strand** | `PATCH /api/sessions/{id}/strands/{sid}/color` | `paint_strand(...)` | Change color |
| **Create Crossover** | `POST /api/sessions/{id}/crossovers` | `create_crossover(...)` | Connect two strands |
| **Remove Crossover** | `DELETE /api/sessions/{id}/crossovers/{cid}` | `remove_crossover(...)` | Disconnect strands |
| **Auto-Staple** | `POST /api/sessions/{id}/autostaple` | `auto_staple()` | Generate staple topology |
| **Undo** | `POST /api/sessions/{id}/undo` | `undo()` | Revert last change |
| **Redo** | `POST /api/sessions/{id}/redo` | `redo()` | Reapply undone change |

---

## Key Design Principles

1. **Session-Based State:** All operations modify a `CadnanoSession` object (backend: `editor_session.py`)
2. **Stateless REST:** Each request returns the full updated state
3. **Undo/Redo:** Full operation history tracked per session
4. **Atomic Operations:** Each API call is a single undo-able operation
5. **ID Assignment:** Auto-incrementing IDs for helices, strands, crossovers
6. **Direction Convention:** Even/odd helix IDs determine scaffold lane

---

## Example Workflows

### Create a 2-Helix Bundle

```python
client = NanoCanvasClient()
client.reset(lattice_type="square")

# Add two helices side-by-side
client.add_helix(row=0, col=0)
client.add_helix(row=0, col=1)

# Create scaffold on both
client.create_scaffold(helix_id=0, start=0, end=32)
client.create_scaffold(helix_id=1, start=0, end=32)

# Join with crossover at index 16
state = client.get_state()
scaffold_0 = [s for s in state['strands'] if s['helix_id'] == 0 and s['direction'] == 1][0]
scaffold_1 = [s for s in state['strands'] if s['helix_id'] == 1 and s['direction'] == -1][0]
client.create_crossover(scaffold_0['id'], 16, scaffold_1['id'], 16)

# Auto-generate staples
client.auto_staple()

# Export to oxDNA
zip_data = client.export_oxdna()
with open("bundle.zip", "wb") as f:
    f.write(zip_data)
```

### Modify Existing Strand

```python
state = client.get_state()
strand_id = state['strands'][0]['id']

# Extend strand
client.set_strand_range(strand_id, start=0, end=40)  # Was 0-32

# Change color
client.paint_strand(strand_id, color="#ff6600")

# Undo if needed
client.undo()
```

---

## Integration Points for oxDNA-viewer

### Potential Sync Events

These operations should trigger live-sync updates to oxDNA-viewer:

1. **Helix Add/Remove** → Update 3D helix representation
2. **Strand Create/Delete** → Add/remove nucleotides in 3D
3. **Strand Range Change** → Extend/shrink 3D strand
4. **Crossover Create/Remove** → Connect/disconnect strands in 3D
5. **Color Change** → Update 3D rendering colors
6. **Undo/Redo** → Sync state changes

### Recommended Approach

1. **WebSocket Layer:** Add WebSocket endpoint to NanoCanvas backend
2. **Event Emission:** After each successful API call, emit event with:
   - `operation` (e.g., "add_helix", "delete_strand")
   - `session_id`
   - `updated_state` or delta
3. **oxDNA-viewer Listener:** Subscribe to WebSocket, translate events to viewer operations

---

## Source Files

### Backend
- `backend/app.py` - FastAPI endpoints
- `backend/editor_session.py` - CadnanoSession state management

### Client
- `LLM/api_client.py` - Python REST client
- `cadnano-app/src/ai/CadnanoAI.ts` - Browser JavaScript wrapper

### Frontend State
- `cadnano-app/src/store/` - React state management
- `cadnano-app/src/api/` - REST client hooks

---

## CORS Configuration

Allowed origins (see `backend/app.py:34-43`):
- `http://localhost:5173` (dev)
- `http://localhost:3000`
- `https://subhajit-roy-partho.github.io` (GitHub Pages)

Add oxDNA-viewer origin when integrating.

---

## Future Extension Points

1. **Base-Level Operations:** Currently strands are modified by range. Could add:
   - `PATCH /strands/{sid}/bases/{idx}` to modify individual bases
   - `POST /strands/{sid}/insertions` for cadnano2 insertions/deletions

2. **Batch Operations:** Could add:
   - `POST /api/sessions/{id}/batch` to apply multiple operations atomically

3. **Live Collaboration:** WebSocket for multi-user editing

4. **Sequence Assignment:** API for applying sequences to scaffolds/staples

---

## Testing

```bash
# Backend API smoke test (no LLM needed)
cd LLM
python run.py test-api  # Tests all 19 endpoints

# Single-shot agent test
python single_shot.py "Add 4 helices in a 2x2 grid"

# Multi-agent pipeline
python multi_agent.py "Create a 6-helix bundle with staples"
```

---

## Related Documentation

- Full API endpoint list: `GET /api/docs` (runtime endpoint)
- LLM agent guide: `LLM/README.md`
- Frontend integration: `cadnano-app/README.md`
- oxDNA export: `backend/README.md`
