/**
 * ID Mapping System for oxDNA-Viewer <-> NanoCanvas Synchronization
 *
 * Maintains bidirectional mappings between:
 * - oxView nucleotides (individual atoms) <-> NanoCanvas strands (groups of nucleotides)
 * - oxView strands <-> NanoCanvas helices
 * - 3D positions <-> 2D lattice coordinates
 */

interface NanoCanvasCoord {
    helix_id: number;
    direction: number;  // 1 = FORWARD, -1 = REVERSE
    index: number;      // base position along helix
}

interface OxViewId {
    element_id: number;
    strand_id: number;
    system_id: number;
}

interface LatticePosition {
    row: number;
    col: number;
    lattice_type: 'honeycomb' | 'square';
}

interface MappingEntry {
    oxview: OxViewId;
    nanocanvas: NanoCanvasCoord;
    lattice: LatticePosition;
    position_3d: THREE.Vector3;
    created_at: number;
    last_synced: number;
}

class IDMapper {
    // Bidirectional lookup tables
    private oxviewToNC: Map<number, NanoCanvasCoord>;  // element_id -> NC coord
    private ncToOxview: Map<string, OxViewId>;         // helix_dir_index -> oxView ID

    // Helix-level mappings
    private helixToStrand: Map<number, number[]>;      // NC helix_id -> oxView strand_ids[]
    private strandToHelix: Map<number, number>;        // oxView strand_id -> NC helix_id

    // Lattice coordinate mappings
    private latticeToHelixId: Map<string, number>;     // "row,col" -> helix_id
    private helixIdToLattice: Map<number, LatticePosition>;

    // Full mapping entries (for debugging and export)
    private fullMappings: Map<number, MappingEntry>;

    // Current lattice type
    private latticeType: 'honeycomb' | 'square';

    // Lattice geometry constants
    private readonly HONEYCOMB_X_SPACING = 2.5;
    private readonly HONEYCOMB_Y_SPACING = 2.1651;  // sqrt(3) * 1.25
    private readonly SQUARE_SPACING = 2.5;
    private readonly NM_PER_BASE = 0.34;  // Rise per base pair

    constructor(latticeType: 'honeycomb' | 'square' = 'honeycomb') {
        this.oxviewToNC = new Map();
        this.ncToOxview = new Map();
        this.helixToStrand = new Map();
        this.strandToHelix = new Map();
        this.latticeToHelixId = new Map();
        this.helixIdToLattice = new Map();
        this.fullMappings = new Map();
        this.latticeType = latticeType;
    }

    /**
     * Generate unique key for NanoCanvas coordinate
     */
    private ncKey(helix_id: number, direction: number, index: number): string {
        return `${helix_id}_${direction}_${index}`;
    }

    /**
     * Generate unique key for lattice position
     */
    private latticeKey(row: number, col: number): string {
        return `${row},${col}`;
    }

    /**
     * Convert lattice coordinates to 3D position
     */
    latticeToPosition(row: number, col: number): THREE.Vector3 {
        let x: number, y: number;

        if (this.latticeType === 'honeycomb') {
            // Honeycomb lattice: offset every other row
            x = col * this.HONEYCOMB_X_SPACING;
            y = row * this.HONEYCOMB_Y_SPACING;
            if (row % 2 === 1) {
                x += this.HONEYCOMB_X_SPACING / 2;
            }
        } else {
            // Square lattice: simple grid
            x = col * this.SQUARE_SPACING;
            y = row * this.SQUARE_SPACING;
        }

        return new THREE.Vector3(x, y, 0);
    }

    /**
     * Convert 3D position to nearest lattice coordinates
     */
    positionToLattice(pos: THREE.Vector3): LatticePosition {
        let row: number, col: number;

        if (this.latticeType === 'honeycomb') {
            // Inverse honeycomb transform
            row = Math.round(pos.y / this.HONEYCOMB_Y_SPACING);
            const xOffset = (row % 2 === 1) ? this.HONEYCOMB_X_SPACING / 2 : 0;
            col = Math.round((pos.x - xOffset) / this.HONEYCOMB_X_SPACING);
        } else {
            // Square lattice
            row = Math.round(pos.y / this.SQUARE_SPACING);
            col = Math.round(pos.x / this.SQUARE_SPACING);
        }

        return { row, col, lattice_type: this.latticeType };
    }

    /**
     * Calculate 3D position along a helix at a given base index
     */
    helixIndexToPosition(row: number, col: number, index: number): THREE.Vector3 {
        const basePos = this.latticeToPosition(row, col);
        // Extend along Z axis (helix axis)
        basePos.z = index * this.NM_PER_BASE;
        return basePos;
    }

    /**
     * Register a new mapping entry
     */
    addMapping(
        elementId: number,
        strandId: number,
        systemId: number,
        helixId: number,
        direction: number,
        index: number,
        row: number,
        col: number,
        position3d: THREE.Vector3
    ): void {
        const oxview: OxViewId = { element_id: elementId, strand_id: strandId, system_id: systemId };
        const nanocanvas: NanoCanvasCoord = { helix_id: helixId, direction, index };
        const lattice: LatticePosition = { row, col, lattice_type: this.latticeType };

        const now = Date.now();
        const entry: MappingEntry = {
            oxview,
            nanocanvas,
            lattice,
            position_3d: position3d,
            created_at: now,
            last_synced: now
        };

        // Store in all lookup tables
        this.oxviewToNC.set(elementId, nanocanvas);
        this.ncToOxview.set(this.ncKey(helixId, direction, index), oxview);
        this.fullMappings.set(elementId, entry);

        // Update helix-strand mappings
        if (!this.helixToStrand.has(helixId)) {
            this.helixToStrand.set(helixId, []);
        }
        if (!this.helixToStrand.get(helixId).includes(strandId)) {
            this.helixToStrand.get(helixId).push(strandId);
        }
        this.strandToHelix.set(strandId, helixId);

        // Update lattice mappings
        this.latticeToHelixId.set(this.latticeKey(row, col), helixId);
        this.helixIdToLattice.set(helixId, lattice);
    }

    /**
     * Look up NanoCanvas coordinate from oxView element ID
     */
    getNCCoord(elementId: number): NanoCanvasCoord | null {
        return this.oxviewToNC.get(elementId) || null;
    }

    /**
     * Look up oxView element ID from NanoCanvas coordinate
     */
    getOxViewId(helixId: number, direction: number, index: number): OxViewId | null {
        return this.ncToOxview.get(this.ncKey(helixId, direction, index)) || null;
    }

    /**
     * Get all oxView strand IDs associated with a NanoCanvas helix
     */
    getStrandsForHelix(helixId: number): number[] {
        return this.helixToStrand.get(helixId) || [];
    }

    /**
     * Get NanoCanvas helix ID for an oxView strand
     */
    getHelixForStrand(strandId: number): number | null {
        return this.strandToHelix.get(strandId) || null;
    }

    /**
     * Get helix ID at lattice position
     */
    getHelixAtLattice(row: number, col: number): number | null {
        return this.latticeToHelixId.get(this.latticeKey(row, col)) || null;
    }

    /**
     * Get lattice position for helix ID
     */
    getLatticeForHelix(helixId: number): LatticePosition | null {
        return this.helixIdToLattice.get(helixId) || null;
    }

    /**
     * Remove mapping for an element
     */
    removeMapping(elementId: number): void {
        const entry = this.fullMappings.get(elementId);
        if (!entry) return;

        const { helix_id, direction, index } = entry.nanocanvas;
        const { strand_id } = entry.oxview;

        this.oxviewToNC.delete(elementId);
        this.ncToOxview.delete(this.ncKey(helix_id, direction, index));
        this.fullMappings.delete(elementId);

        // Clean up helix-strand mappings if this was the last element on that strand
        const strandsOnHelix = this.helixToStrand.get(helix_id);
        if (strandsOnHelix) {
            const idx = strandsOnHelix.indexOf(strand_id);
            if (idx !== -1) {
                strandsOnHelix.splice(idx, 1);
            }
            if (strandsOnHelix.length === 0) {
                this.helixToStrand.delete(helix_id);
            }
        }
    }

    /**
     * Update last sync timestamp
     */
    touchMapping(elementId: number): void {
        const entry = this.fullMappings.get(elementId);
        if (entry) {
            entry.last_synced = Date.now();
        }
    }

    /**
     * Clear all mappings
     */
    clear(): void {
        this.oxviewToNC.clear();
        this.ncToOxview.clear();
        this.helixToStrand.clear();
        this.strandToHelix.clear();
        this.latticeToHelixId.clear();
        this.helixIdToLattice.clear();
        this.fullMappings.clear();
    }

    /**
     * Export all mappings as JSON
     */
    exportMappings(): string {
        const data = {
            lattice_type: this.latticeType,
            mappings: Array.from(this.fullMappings.values()).map(entry => ({
                oxview: entry.oxview,
                nanocanvas: entry.nanocanvas,
                lattice: entry.lattice,
                position_3d: {
                    x: entry.position_3d.x,
                    y: entry.position_3d.y,
                    z: entry.position_3d.z
                },
                created_at: entry.created_at,
                last_synced: entry.last_synced
            }))
        };
        return JSON.stringify(data, null, 2);
    }

    /**
     * Import mappings from JSON
     */
    importMappings(json: string): void {
        const data = JSON.parse(json);
        this.clear();
        this.latticeType = data.lattice_type;

        data.mappings.forEach((entry: any) => {
            this.addMapping(
                entry.oxview.element_id,
                entry.oxview.strand_id,
                entry.oxview.system_id,
                entry.nanocanvas.helix_id,
                entry.nanocanvas.direction,
                entry.nanocanvas.index,
                entry.lattice.row,
                entry.lattice.col,
                new THREE.Vector3(
                    entry.position_3d.x,
                    entry.position_3d.y,
                    entry.position_3d.z
                )
            );
        });
    }

    /**
     * Get statistics about current mappings
     */
    getStats(): object {
        return {
            total_mappings: this.fullMappings.size,
            unique_helices: this.helixToStrand.size,
            unique_strands: this.strandToHelix.size,
            lattice_type: this.latticeType
        };
    }
}

// Global singleton instance
const idMapper = new IDMapper();
