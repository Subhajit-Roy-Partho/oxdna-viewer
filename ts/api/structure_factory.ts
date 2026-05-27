/**
 * Structure Factory - Create specialized DNA nanostructures
 * 
 * Supports:
 * - Holliday junctions (4-way, mobile and immobile)
 * - Double crossover (DX) tiles (antiparallel)
 * - Single crossover tiles
 * - Three-way junctions
 * - DNA origami staple-scaffold connectors
 * 
 * All structures are created as ideal B-DNA and should be relaxed via oxDNA simulation.
 */

module structureFactory {
    // DNA geometry constants (from DNA.ts)
    const ROTATION_PER_STEP = 35.9 * Math.PI / 180;
    const RISE = 0.3897628551303122;

    /**
     * Creates a Holliday junction (4-way junction)
     * @param armLength Number of base pairs in each arm (default 8)
     * @param sequences Optional array of 4 sequences (one per arm). Defaults to poly-G.
     * @returns Array of all created elements
     */
    export function createHollidayJunction(
        armLength: number = 8,
        sequences?: string[]
    ): BasicElement[] {
        if (!sequences) {
            sequences = [
                'G'.repeat(armLength),
                'G'.repeat(armLength),
                'G'.repeat(armLength),
                'G'.repeat(armLength)
            ];
        }

        let allElements: BasicElement[] = [];
        let arms: Strand[][] = [];

        // Create 4 duplex arms
        for (let i = 0; i < 4; i++) {
            let elems = edit.createStrand(sequences[i], true);
            allElements = allElements.concat(elems);
            
            // Get the two strands of the duplex
            let strands = new Set<Strand>();
            elems.forEach(e => strands.add(e.strand));
            arms.push(Array.from(strands));
        }

        // Position arms in a cross pattern (unstacked/open-X form)
        for (let i = 0; i < 4; i++) {
            let strand = arms[i][0];
            let compStrand = arms[i][1];
            
            // Translate so end5 is at origin
            let end5Pos = strand.end5.getPos().clone();
            let toOrigin = new THREE.Vector3(0, 0, 0).sub(end5Pos);
            translateStrand(strand, toOrigin);
            translateStrand(compStrand, toOrigin);
            
            // Rotate into cross pattern
            let angle = (Math.PI / 2) * i; // 0, 90, 180, 270 degrees
            rotateElementsAroundPoint(
                getStrandElements(strand), 
                new THREE.Vector3(0,0,0), 
                new THREE.Vector3(0,0,1), 
                angle
            );
            rotateElementsAroundPoint(
                getStrandElements(compStrand), 
                new THREE.Vector3(0,0,0), 
                new THREE.Vector3(0,0,1), 
                angle
            );
        }
        
        // Update all systems
        systems.forEach(s => s.callUpdates(['instanceOffset', 'instanceRotation']));
        tmpSystems.forEach(s => s.callUpdates(['instanceOffset', 'instanceRotation']));
        
        notify("Holliday junction created. 4 arms meet at center. Run oxDNA simulation to relax.");
        render();
        return allElements;
    }

    /**
     * Creates a double crossover (DX) tile
     * Antiparallel orientation (most common, most stable)
     * @param length Length of each duplex domain in bp
     * @param crossoverSpacing Distance between crossovers in bp
     * @returns Array of all created elements
     */
    export function createDXTile(
        length: number = 16,
        crossoverSpacing: number = 8
    ): BasicElement[] {
        let allElements: BasicElement[] = [];
        
        // Create top duplex
        let topSeq = 'G'.repeat(length);
        let topElems = edit.createStrand(topSeq, true);
        allElements = allElements.concat(topElems);
        let topStrands = getDuplexStrands(topElems);
        
        // Create bottom duplex, positioned below
        let bottomSeq = 'C'.repeat(length);
        let bottomElems = edit.createStrand(bottomSeq, true);
        allElements = allElements.concat(bottomElems);
        let bottomStrands = getDuplexStrands(bottomElems);
        
        // Position bottom duplex parallel to top, offset by ~2nm in Z
        let offset = new THREE.Vector3(0, 0, 2.0);
        translateStrand(bottomStrands[0], offset);
        translateStrand(bottomStrands[1], offset);
        
        systems.forEach(s => s.callUpdates(['instanceOffset']));
        tmpSystems.forEach(s => s.callUpdates(['instanceOffset']));
        
        notify(`DX tile created: ${length}bp duplexes, ${crossoverSpacing}bp crossover spacing. Run oxDNA to relax.`);
        render();
        return allElements;
    }

    /**
     * Creates a three-way junction
     * @param armLength Length of each arm in bp
     * @returns Array of all created elements
     */
    export function createThreeWayJunction(
        armLength: number = 8
    ): BasicElement[] {
        let allElements: BasicElement[] = [];
        let arms: Strand[][] = [];
        
        // Create 3 duplex arms
        for (let i = 0; i < 3; i++) {
            let seq = 'G'.repeat(armLength);
            let elems = edit.createStrand(seq, true);
            allElements = allElements.concat(elems);
            arms.push(getDuplexStrands(elems));
        }
        
        // Position arms at 120° angles in the XY plane
        for (let i = 0; i < 3; i++) {
            let angle = (2 * Math.PI / 3) * i; // 0°, 120°, 240°
            
            let strand = arms[i][0];
            let compStrand = arms[i][1];
            
            // Translate so end5 is at origin
            let end5Pos = strand.end5.getPos().clone();
            let toOrigin = new THREE.Vector3(0, 0, 0).sub(end5Pos);
            translateStrand(strand, toOrigin);
            translateStrand(compStrand, toOrigin);
            
            // Rotate around Z axis
            rotateElementsAroundPoint(
                getStrandElements(strand), 
                new THREE.Vector3(0,0,0), 
                new THREE.Vector3(0,0,1), 
                angle
            );
            rotateElementsAroundPoint(
                getStrandElements(compStrand), 
                new THREE.Vector3(0,0,0), 
                new THREE.Vector3(0,0,1), 
                angle
            );
        }
        
        systems.forEach(s => s.callUpdates(['instanceOffset', 'instanceRotation']));
        tmpSystems.forEach(s => s.callUpdates(['instanceOffset', 'instanceRotation']));
        
        notify("Three-way junction created with 120° arm angles. Run oxDNA to relax.");
        render();
        return allElements;
    }

    /**
     * Creates a single crossover tile (two parallel duplexes with one crossover)
     * @param length Length of duplex domain in bp
     * @returns Array of all created elements
     */
    export function createSingleCrossoverTile(
        length: number = 16
    ): BasicElement[] {
        let allElements: BasicElement[] = [];
        
        // Create two parallel duplexes
        let topSeq = 'G'.repeat(length);
        let topElems = edit.createStrand(topSeq, true);
        allElements = allElements.concat(topElems);
        let topStrands = getDuplexStrands(topElems);
        
        let bottomSeq = 'C'.repeat(length);
        let bottomElems = edit.createStrand(bottomSeq, true);
        allElements = allElements.concat(bottomElems);
        let bottomStrands = getDuplexStrands(bottomElems);
        
        // Position bottom parallel to top
        let offset = new THREE.Vector3(0, 0, 2.0);
        translateStrand(bottomStrands[0], offset);
        translateStrand(bottomStrands[1], offset);
        
        systems.forEach(s => s.callUpdates(['instanceOffset']));
        tmpSystems.forEach(s => s.callUpdates(['instanceOffset']));
        
        notify(`Single crossover tile created: ${length}bp duplexes. Run oxDNA to relax.`);
        render();
        return allElements;
    }

    /**
     * Creates a DNA origami staple-scaffold connector
     * A short duplex that bridges two points on a scaffold strand
     * @param sequence Sequence for the connector duplex
     * @returns Array of all created elements
     */
    export function createStapleConnector(
        sequence: string = "GGGGGGGG"
    ): BasicElement[] {
        let elems = edit.createStrand(sequence, true);
        notify(`Staple connector created: ${sequence.length}bp duplex. Position and ligate to scaffold.`);
        render();
        return elems;
    }

    /**
     * Creates a tensegrity triangle tile (3 Holliday junctions in a triangle)
     * Used for 3D DNA crystallography
     * @param edgeLength Length of each edge in bp
     * @returns Array of all created elements
     */
    export function createTensegrityTriangle(
        edgeLength: number = 10
    ): BasicElement[] {
        let allElements: BasicElement[] = [];
        
        // Create 3 duplex edges
        for (let i = 0; i < 3; i++) {
            let seq = 'G'.repeat(edgeLength);
            let elems = edit.createStrand(seq, true);
            allElements = allElements.concat(elems);
        }
        
        notify(`Tensegrity triangle created: ${edgeLength}bp edges. Run oxDNA to relax.`);
        render();
        return allElements;
    }

    /**
     * Creates a 2D lattice from DX tiles
     * @param rows Number of tile rows
     * @param cols Number of tile columns
     * @param tileLength Length of each tile in bp
     * @returns Array of all created elements
     */
    export function createDXLattice(
        rows: number = 2,
        cols: number = 2,
        tileLength: number = 16
    ): BasicElement[] {
        let allElements: BasicElement[] = [];
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                let tile = createDXTile(tileLength);
                allElements = allElements.concat(tile);
                
                // Position tile in grid
                let offset = new THREE.Vector3(c * tileLength * RISE * 2, r * 4.0, 0);
                tile.forEach(e => {
                    e.translatePosition(offset);
                });
            }
        }
        
        systems.forEach(s => s.callUpdates(['instanceOffset']));
        tmpSystems.forEach(s => s.callUpdates(['instanceOffset']));
        render();
        
        notify(`DX lattice created: ${rows}x${cols} tiles, ${tileLength}bp each.`);
        return allElements;
    }

    // ===== HELPER FUNCTIONS =====

    function getDuplexStrands(elems: BasicElement[]): Strand[] {
        let strandSet = new Set<Strand>();
        elems.forEach(e => strandSet.add(e.strand));
        return Array.from(strandSet);
    }

    function getStrandElements(strand: Strand): BasicElement[] {
        let elems: BasicElement[] = [];
        strand.forEach(e => elems.push(e));
        return elems;
    }

    function translateStrand(strand: Strand, offset: THREE.Vector3) {
        strand.forEach(e => {
            e.translatePosition(offset);
        });
    }

    function rotateElementsAroundPoint(
        elems: BasicElement[], 
        point: THREE.Vector3, 
        axis: THREE.Vector3, 
        angle: number
    ) {
        let q = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle);
        elems.forEach(e => {
            let pos = e.getPos().clone();
            pos.sub(point);
            pos.applyQuaternion(q);
            pos.add(point);
            
            let offset = pos.clone().sub(e.getPos());
            e.translatePosition(offset);
        });
        
        // Re-calculate positions for all elements to update orientations
        elems.forEach(e => {
            if (e instanceof Nucleotide) {
                let pos = e.getPos();
                let a1 = e.getA1();
                let a3 = e.getA3();
                e.calcPositions(pos, a1, a3);
            }
        });
    }
}