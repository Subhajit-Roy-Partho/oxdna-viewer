/**
 * NanoCanvas Synchronization API
 *
 * High-level API for creating and manipulating DNA structures
 * with automatic ID mapping and synchronization support.
 *
 * This module provides NanoCanvas-compatible operations that:
 * 1. Create oxView nucleotides at lattice-aligned positions
 * 2. Maintain bidirectional ID mappings
 * 3. Emit events for WebSocket synchronization
 * 4. Support undo/redo through existing oxView infrastructure
 */

/// <reference path="id_mapping.ts" />

module ncSync {
    /**
     * Event emitter for WebSocket synchronization
     */
    interface SyncEvent {
        type: string;
        source: 'oxview' | 'nanocanvas';
        timestamp: number;
        data: any;
    }

    type EventCallback = (event: SyncEvent) => void;
    const eventListeners: Map<string, EventCallback[]> = new Map();

    export function addEventListener(eventType: string, callback: EventCallback): void {
        if (!eventListeners.has(eventType)) {
            eventListeners.set(eventType, []);
        }
        eventListeners.get(eventType).push(callback);
    }

    export function removeEventListener(eventType: string, callback: EventCallback): void {
        const listeners = eventListeners.get(eventType);
        if (listeners) {
            const idx = listeners.indexOf(callback);
            if (idx !== -1) {
                listeners.splice(idx, 1);
            }
        }
    }

    function emitEvent(event: SyncEvent): void {
        const listeners = eventListeners.get(event.type);
        if (listeners) {
            listeners.forEach(callback => callback(event));
        }
        // Also emit to wildcard listeners
        const wildcardListeners = eventListeners.get('*');
        if (wildcardListeners) {
            wildcardListeners.forEach(callback => callback(event));
        }
    }

    /**
     * Create a helix (vertical DNA duplex column) at a lattice position
     * @param row Lattice row coordinate
     * @param col Lattice column coordinate
     * @param maxBases Maximum number of bases (height of helix)
     * @param helixId Optional helix ID (for NC sync), auto-assigned if not provided
     * @returns Created elements and helix metadata
     */
    export function createHelix(
        row: number,
        col: number,
        maxBases: number = 32,
        helixId?: number
    ): { elements: BasicElement[], helixId: number } {
        // Generate helix ID if not provided
        if (helixId === undefined) {
            helixId = Date.now() % 1000000;  // Simple auto-increment
        }

        // Create a short duplex scaffold strand
        const sequence = 'A'.repeat(maxBases);
        const elements = edit.createStrand(sequence, true, false);

        // Move to lattice position
        const targetPos = idMapper.latticeToPosition(row, col);
        const firstElem = elements[0];
        const currentPos = firstElem.getPos();
        const offset = targetPos.sub(currentPos);

        translateElements(new Set(elements), offset);

        // Register mappings for all elements
        elements.forEach((elem, index) => {
            const direction = (index % 2 === 0) ? 1 : -1;  // Alternating strand directions
            const strandId = elem.strand.id;
            const systemId = elem.getSystem().systemID;

            idMapper.addMapping(
                elem.id,
                strandId,
                systemId,
                helixId,
                direction,
                Math.floor(index / 2),  // Base index along helix
                row,
                col,
                elem.getPos()
            );
        });

        // Emit sync event
        emitEvent({
            type: 'helix_created',
            source: 'oxview',
            timestamp: Date.now(),
            data: {
                helix_id: helixId,
                row,
                col,
                max_bases: maxBases,
                element_ids: elements.map(e => e.id)
            }
        });

        render();
        return { elements, helixId };
    }

    /**
     * Remove a helix and all strands on it
     * @param helixId NanoCanvas helix ID
     */
    export function removeHelix(helixId: number): void {
        const strandIds = idMapper.getStrandsForHelix(helixId);
        const elementsToDelete: BasicElement[] = [];

        strandIds.forEach(strandId => {
            const strand = systems.flatMap(s => s.strands).find(s => s.id === strandId);
            if (strand) {
                strand.forEach(elem => {
                    elementsToDelete.push(elem);
                    idMapper.removeMapping(elem.id);
                });
            }
        });

        if (elementsToDelete.length > 0) {
            edit.deleteElements(elementsToDelete);
        }

        emitEvent({
            type: 'helix_removed',
            source: 'oxview',
            timestamp: Date.now(),
            data: { helix_id: helixId, deleted_elements: elementsToDelete.length }
        });

        render();
    }

    /**
     * Create a strand segment on a helix
     * @param helixId Helix ID
     * @param direction 1 = FORWARD (5'→3'), -1 = REVERSE (3'→5')
     * @param startIndex Start base index
     * @param endIndex End base index (exclusive)
     * @param color Optional color hex string
     * @param strandId Optional strand ID (for NC sync)
     * @returns Created elements
     */
    export function createStrand(
        helixId: number,
        direction: number,
        startIndex: number,
        endIndex: number,
        color?: string,
        strandId?: number
    ): BasicElement[] {
        if (strandId === undefined) {
            strandId = Date.now() % 1000000;
        }

        const lattice = idMapper.getLatticeForHelix(helixId);
        if (!lattice) {
            notify(`Helix ${helixId} not found in mapping`);
            return [];
        }

        const length = endIndex - startIndex;
        const sequence = 'T'.repeat(length);

        // Create strand
        const elements = edit.createStrand(sequence, false, false);

        // Position along helix
        const startPos = idMapper.helixIndexToPosition(lattice.row, lattice.col, startIndex);
        const firstElem = elements[0];
        const offset = startPos.sub(firstElem.getPos());
        translateElements(new Set(elements), offset);

        // Apply color if provided
        if (color) {
            elements.forEach(elem => {
                elem.elemToColor(new THREE.Color(color));
            });
        }

        // Register mappings
        elements.forEach((elem, idx) => {
            const systemId = elem.getSystem().systemID;
            idMapper.addMapping(
                elem.id,
                elem.strand.id,
                systemId,
                helixId,
                direction,
                startIndex + idx,
                lattice.row,
                lattice.col,
                elem.getPos()
            );
        });

        emitEvent({
            type: 'strand_created',
            source: 'oxview',
            timestamp: Date.now(),
            data: {
                strand_id: strandId,
                helix_id: helixId,
                direction,
                start: startIndex,
                end: endIndex,
                color,
                element_ids: elements.map(e => e.id)
            }
        });

        render();
        return elements;
    }

    /**
     * Delete a strand segment
     * @param strandId NanoCanvas strand ID
     */
    export function deleteStrand(strandId: number): void {
        // Find all elements belonging to this strand via mapping
        const elementsToDelete: BasicElement[] = [];

        // Search through all mappings to find elements with this strand_id
        systems.forEach(sys => {
            sys.strands.forEach(strand => {
                if (strand.id === strandId) {
                    strand.forEach(elem => {
                        elementsToDelete.push(elem);
                        idMapper.removeMapping(elem.id);
                    });
                }
            });
        });

        if (elementsToDelete.length > 0) {
            edit.deleteElements(elementsToDelete);
        }

        emitEvent({
            type: 'strand_deleted',
            source: 'oxview',
            timestamp: Date.now(),
            data: { strand_id: strandId, deleted_elements: elementsToDelete.length }
        });

        render();
    }

    /**
     * Create a crossover (connection) between two strands
     * @param helixIdA First helix
     * @param directionA First strand direction
     * @param indexA First strand base index
     * @param helixIdB Second helix
     * @param directionB Second strand direction
     * @param indexB Second strand base index
     */
    export function createCrossover(
        helixIdA: number,
        directionA: number,
        indexA: number,
        helixIdB: number,
        directionB: number,
        indexB: number
    ): void {
        const elemA = elements.get(
            idMapper.getOxViewId(helixIdA, directionA, indexA)?.element_id
        );
        const elemB = elements.get(
            idMapper.getOxViewId(helixIdB, directionB, indexB)?.element_id
        );

        if (!elemA || !elemB) {
            notify('Could not find elements for crossover');
            return;
        }

        // Use existing ligate function
        edit.ligate(elemA as BasicElement, elemB as BasicElement);

        emitEvent({
            type: 'crossover_created',
            source: 'oxview',
            timestamp: Date.now(),
            data: {
                helix_a: helixIdA,
                direction_a: directionA,
                index_a: indexA,
                helix_b: helixIdB,
                direction_b: directionB,
                index_b: indexB
            }
        });

        render();
    }

    /**
     * Remove a crossover (nick the connection)
     * @param helixId Helix containing the crossover point
     * @param direction Strand direction
     * @param index Base index
     */
    export function removeCrossover(
        helixId: number,
        direction: number,
        index: number
    ): void {
        const oxId = idMapper.getOxViewId(helixId, direction, index);
        if (!oxId) {
            notify('Could not find element for crossover removal');
            return;
        }

        const elem = elements.get(oxId.element_id) as BasicElement;
        if (elem) {
            edit.nick(elem);
        }

        emitEvent({
            type: 'crossover_removed',
            source: 'oxview',
            timestamp: Date.now(),
            data: { helix_id: helixId, direction, index }
        });

        render();
    }

    /**
     * Add a single nucleotide at a specific position
     * @param helixId Helix ID
     * @param direction Strand direction
     * @param index Base index
     * @param baseType Base type (A, T, G, C)
     * @returns Created element
     */
    export function addNucleotide(
        helixId: number,
        direction: number,
        index: number,
        baseType: string = 'A'
    ): BasicElement | null {
        const lattice = idMapper.getLatticeForHelix(helixId);
        if (!lattice) {
            notify(`Helix ${helixId} not found`);
            return null;
        }

        // Create single nucleotide
        const elements = edit.createStrand(baseType, false, false);
        const elem = elements[0];

        // Position at specific index on helix
        const targetPos = idMapper.helixIndexToPosition(lattice.row, lattice.col, index);
        const offset = targetPos.sub(elem.getPos());
        translateElements(new Set([elem]), offset);

        // Register mapping
        idMapper.addMapping(
            elem.id,
            elem.strand.id,
            elem.getSystem().systemID,
            helixId,
            direction,
            index,
            lattice.row,
            lattice.col,
            elem.getPos()
        );

        emitEvent({
            type: 'nucleotide_added',
            source: 'oxview',
            timestamp: Date.now(),
            data: { helix_id: helixId, direction, index, base_type: baseType, element_id: elem.id }
        });

        render();
        return elem;
    }

    /**
     * Remove a single nucleotide
     * @param helixId Helix ID
     * @param direction Strand direction
     * @param index Base index
     */
    export function removeNucleotide(
        helixId: number,
        direction: number,
        index: number
    ): void {
        const oxId = idMapper.getOxViewId(helixId, direction, index);
        if (!oxId) {
            notify('Nucleotide not found');
            return;
        }

        const elem = elements.get(oxId.element_id) as BasicElement;
        if (elem) {
            edit.deleteElements([elem]);
            idMapper.removeMapping(oxId.element_id);
        }

        emitEvent({
            type: 'nucleotide_removed',
            source: 'oxview',
            timestamp: Date.now(),
            data: { helix_id: helixId, direction, index }
        });

        render();
    }

    /**
     * Change base type of an existing nucleotide
     * @param helixId Helix ID
     * @param direction Strand direction
     * @param index Base index
     * @param newType New base type (A, T, G, C)
     */
    export function changeBaseType(
        helixId: number,
        direction: number,
        index: number,
        newType: string
    ): void {
        const oxId = idMapper.getOxViewId(helixId, direction, index);
        if (!oxId) {
            notify('Nucleotide not found');
            return;
        }

        const elem = elements.get(oxId.element_id) as BasicElement;
        if (elem && 'setType' in elem) {
            (elem as any).setType(newType);
            elem.getSystem().callUpdates(['instanceColor']);
        }

        emitEvent({
            type: 'base_type_changed',
            source: 'oxview',
            timestamp: Date.now(),
            data: { helix_id: helixId, direction, index, new_type: newType }
        });

        render();
    }

    /**
     * Get current state of all helices (for sync)
     */
    export function getHelixState(): object[] {
        const helices: object[] = [];
        const processedHelices = new Set<number>();

        systems.forEach(sys => {
            sys.strands.forEach(strand => {
                strand.forEach(elem => {
                    const ncCoord = idMapper.getNCCoord(elem.id);
                    if (ncCoord && !processedHelices.has(ncCoord.helix_id)) {
                        const lattice = idMapper.getLatticeForHelix(ncCoord.helix_id);
                        if (lattice) {
                            helices.push({
                                helix_id: ncCoord.helix_id,
                                row: lattice.row,
                                col: lattice.col,
                                lattice_type: lattice.lattice_type
                            });
                            processedHelices.add(ncCoord.helix_id);
                        }
                    }
                });
            });
        });

        return helices;
    }

    /**
     * Get current state of all strands (for sync)
     */
    export function getStrandState(): object[] {
        const strands: object[] = [];
        const processedStrands = new Set<number>();

        systems.forEach(sys => {
            sys.strands.forEach(strand => {
                if (processedStrands.has(strand.id)) return;

                const firstElem = strand.end5 || strand.forEach((e, i) => i === 0 ? e : null);
                if (!firstElem) return;

                const ncCoord = idMapper.getNCCoord(firstElem.id);
                if (ncCoord) {
                    const strandElements: BasicElement[] = [];
                    strand.forEach(e => strandElements.push(e));

                    strands.push({
                        strand_id: strand.id,
                        helix_id: ncCoord.helix_id,
                        direction: ncCoord.direction,
                        start_index: ncCoord.index,
                        length: strandElements.length,
                        color: firstElem.color ? '#' + firstElem.color.getHexString() : null
                    });

                    processedStrands.add(strand.id);
                }
            });
        });

        return strands;
    }

    /**
     * Export full sync state
     */
    export function exportSyncState(): string {
        return JSON.stringify({
            helices: getHelixState(),
            strands: getStrandState(),
            mappings: JSON.parse(idMapper.exportMappings()),
            timestamp: Date.now()
        }, null, 2);
    }

    /**
     * Import and reconstruct state from NanoCanvas
     * @param ncState NanoCanvas session state
     */
    export function importFromNanoCanvas(ncState: any): void {
        // Clear existing structures
        idMapper.clear();

        // Create helices
        if (ncState.helices) {
            ncState.helices.forEach((helix: any) => {
                createHelix(helix.row, helix.col, helix.max_bases || 32, helix.id);
            });
        }

        // Create strands
        if (ncState.strands) {
            ncState.strands.forEach((strand: any) => {
                createStrand(
                    strand.helix_id,
                    strand.direction,
                    strand.start,
                    strand.end,
                    strand.color,
                    strand.id
                );
            });
        }

        // Create crossovers
        if (ncState.crossovers) {
            ncState.crossovers.forEach((xover: any) => {
                createCrossover(
                    xover.helix_id_a,
                    xover.direction_a,
                    xover.index_a,
                    xover.helix_id_b,
                    xover.direction_b,
                    xover.index_b
                );
            });
        }

        notify('Imported NanoCanvas state successfully');
        render();
    }
}
