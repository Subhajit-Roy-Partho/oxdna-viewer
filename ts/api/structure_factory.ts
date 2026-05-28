/**
 * Structure Factory - Create specialized DNA nanostructures
 *
 * Supports:
 * - Holliday junctions (4-way)
 * - Double crossover (DX) tiles
 * - Single crossover tiles
 * - Three-way junctions
 * - DNA origami staple-scaffold connectors
 * - Tensegrity triangles
 * - DX lattices
 *
 * All structures are created as ideal B-DNA and should be relaxed via oxDNA simulation.
 */

module structureFactory {
    // DNA geometry constants (from DNA.ts)
    const RISE = 0.3897628551303122;

    /**
     * Creates a Holliday junction (4-way junction) in an unstacked/open-X conformation.
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
        let armElemSets: Set<BasicElement>[] = [];

        // Create 4 duplex arms
        for (let i = 0; i < 4; i++) {
            let elems = edit.createStrand(sequences[i], true);
            allElements = allElements.concat(elems);
            armElemSets.push(new Set(elems));
        }

        // Position arms in a cross pattern (unstacked/open-X form)
        // Arm 0: +X, Arm 1: +Y, Arm 2: -X, Arm 3: -Y
        for (let i = 0; i < 4; i++) {
            let elems = armElemSets[i];
            let angle = (Math.PI / 2) * i; // 0, 90, 180, 270 degrees

            // Translate so the inner end (first base, 3' end) is at the origin
            // The first base in the set is the one closest to the origin after creation
            let firstElem = Array.from(elems)[0];
            let firstPos = firstElem.getPos().clone();
            let toOrigin = new THREE.Vector3(0, 0, 0).sub(firstPos);
            translateElements(elems, toOrigin);

            // Rotate around Z axis through origin
            if (Math.abs(angle) > 0.001) {
                rotateElementsByQuaternion(elems, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle));
            }
        }

        render();
        notify("Holliday junction created. 4 arms meet at center. Run oxDNA simulation to relax.");
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

        // Create bottom duplex
        let bottomSeq = 'C'.repeat(length);
        let bottomElems = edit.createStrand(bottomSeq, true);
        allElements = allElements.concat(bottomElems);

        // Position bottom duplex parallel to top, offset by ~2nm in Z
        translateElements(new Set(bottomElems), new THREE.Vector3(0, 0, 2.4));

        render();
        notify(`DX tile created: ${length}bp duplexes, ${crossoverSpacing}bp crossover spacing. Run oxDNA to relax.`);
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
        let armElemSets: Set<BasicElement>[] = [];

        // Create 3 duplex arms
        for (let i = 0; i < 3; i++) {
            let seq = 'G'.repeat(armLength);
            let elems = edit.createStrand(seq, true);
            allElements = allElements.concat(elems);
            armElemSets.push(new Set(elems));
        }

        // Position arms at 120deg angles in the XY plane
        for (let i = 0; i < 3; i++) {
            let elems = armElemSets[i];
            let angle = (2 * Math.PI / 3) * i; // 0deg, 120deg, 240deg

            // Translate first base to origin
            let firstElem = Array.from(elems)[0];
            let firstPos = firstElem.getPos().clone();
            let toOrigin = new THREE.Vector3(0, 0, 0).sub(firstPos);
            translateElements(elems, toOrigin);

            // Rotate around Z axis
            if (Math.abs(angle) > 0.001) {
                rotateElementsByQuaternion(elems, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle));
            }
        }

        render();
        notify("Three-way junction created with 120deg arm angles. Run oxDNA to relax.");
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

        let bottomSeq = 'C'.repeat(length);
        let bottomElems = edit.createStrand(bottomSeq, true);
        allElements = allElements.concat(bottomElems);

        // Position bottom parallel to top
        translateElements(new Set(bottomElems), new THREE.Vector3(0, 0, 2.4));

        render();
        notify(`Single crossover tile created: ${length}bp duplexes. Run oxDNA to relax.`);
        return allElements;
    }

    /**
     * Creates a DNA origami staple-scaffold connector
     * @param sequence Sequence for the connector duplex
     * @returns Array of all created elements
     */
    export function createStapleConnector(
        sequence: string = "GGGGGGGG"
    ): BasicElement[] {
        let elems = edit.createStrand(sequence, true);
        render();
        notify(`Staple connector created: ${sequence.length}bp duplex. Position and ligate to scaffold.`);
        return elems;
    }

    /**
     * Creates a tensegrity triangle tile
     * @param edgeLength Length of each edge in bp
     * @returns Array of all created elements
     */
    export function createTensegrityTriangle(
        edgeLength: number = 10
    ): BasicElement[] {
        let allElements: BasicElement[] = [];
        let armElemSets: Set<BasicElement>[] = [];

        // Create 3 duplex edges
        for (let i = 0; i < 3; i++) {
            let seq = 'G'.repeat(edgeLength);
            let elems = edit.createStrand(seq, true);
            allElements = allElements.concat(elems);
            armElemSets.push(new Set(elems));
        }

        // Position 3 edges of an equilateral triangle in the XY plane
        // Vertices at (0, r, 0), (-r*sqrt(3)/2, -r/2, 0), (r*sqrt(3)/2, -r/2, 0)
        const r = edgeLength * RISE * 0.866; // radius of circumscribed circle
        const vertices = [
            new THREE.Vector3(0, r, 0),
            new THREE.Vector3(-r * 0.866, -r * 0.5, 0),
            new THREE.Vector3(r * 0.866, -r * 0.5, 0)
        ];

        for (let i = 0; i < 3; i++) {
            let elems = armElemSets[i];

            // Translate first base to vertex i
            let firstElem = Array.from(elems)[0];
            let firstPos = firstElem.getPos().clone();
            let toVertex = vertices[i].clone().sub(firstPos);
            translateElements(elems, toVertex);

            // Rotate so the arm points toward vertex (i+1)%3
            let lastElem = Array.from(elems)[elems.size - 1];
            let currentDir = lastElem.getPos().clone().sub(firstElem.getPos()).normalize();
            let desiredDir = vertices[(i + 1) % 3].clone().sub(vertices[i]).normalize();

            let rotAxis = new THREE.Vector3().crossVectors(currentDir, desiredDir).normalize();
            let rotAngle = Math.acos(Math.max(-1, Math.min(1, currentDir.dot(desiredDir))));

            if (rotAxis.length() > 0.001 && Math.abs(rotAngle) > 0.001) {
                rotateElementsByQuaternion(elems, new THREE.Quaternion().setFromAxisAngle(rotAxis, rotAngle), vertices[i]);
            }
        }

        render();
        notify(`Tensegrity triangle created: ${edgeLength}bp edges. Run oxDNA to relax.`);
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
                let offset = new THREE.Vector3(c * tileLength * RISE * 2.5, r * 4.8, 0);
                translateElements(new Set(tile), offset);
            }
        }

        render();
        notify(`DX lattice created: ${rows}x${cols} tiles, ${tileLength}bp each.`);
        return allElements;
    }
}