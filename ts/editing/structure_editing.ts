/**
 * Structure Factory editing wrappers
 * UI-facing functions for creating DNA nanostructures
 */

function createHollidayJunctionWrapper() {
    let armLength = parseInt((document.getElementById('hjArmLength') as HTMLInputElement).value);
    if (isNaN(armLength) || armLength < 2) {
        notify("Please enter a valid arm length (>= 2)", "alert");
        return;
    }
    
    let seqsStr = (document.getElementById('hjSequences') as HTMLTextAreaElement).value.trim();
    let sequences: string[] = null;
    if (seqsStr) {
        sequences = seqsStr.split(/\s+/).filter(s => s.length > 0);
        if (sequences.length !== 4) {
            notify("Please provide exactly 4 sequences (one per arm), or leave blank for auto", "alert");
            return;
        }
    }
    
    let elems = structureFactory.createHollidayJunction(armLength, sequences);
    if (elems && elems.length > 0) {
        api.selectElements(elems);
        topologyEdited = true;
    }
}

function createDXTileWrapper() {
    let length = parseInt((document.getElementById('dxLength') as HTMLInputElement).value);
    let spacing = parseInt((document.getElementById('dxSpacing') as HTMLInputElement).value);
    
    if (isNaN(length) || length < 4) {
        notify("Please enter a valid tile length (>= 4)", "alert");
        return;
    }
    if (isNaN(spacing) || spacing < 2) {
        notify("Please enter a valid crossover spacing (>= 2)", "alert");
        return;
    }
    
    let elems = structureFactory.createDXTile(length, spacing);
    if (elems && elems.length > 0) {
        api.selectElements(elems);
        topologyEdited = true;
    }
}

function createThreeWayJunctionWrapper() {
    let armLength = parseInt((document.getElementById('twjArmLength') as HTMLInputElement).value);
    if (isNaN(armLength) || armLength < 2) {
        notify("Please enter a valid arm length (>= 2)", "alert");
        return;
    }
    
    let elems = structureFactory.createThreeWayJunction(armLength);
    if (elems && elems.length > 0) {
        api.selectElements(elems);
        topologyEdited = true;
    }
}

function createSingleCrossoverTileWrapper() {
    let length = parseInt((document.getElementById('scLength') as HTMLInputElement).value);
    if (isNaN(length) || length < 4) {
        notify("Please enter a valid tile length (>= 4)", "alert");
        return;
    }
    
    let elems = structureFactory.createSingleCrossoverTile(length);
    if (elems && elems.length > 0) {
        api.selectElements(elems);
        topologyEdited = true;
    }
}

function createStapleConnectorWrapper() {
    let seq = (document.getElementById('scSequence') as HTMLInputElement).value.trim().toUpperCase();
    if (!seq || !/^[ATCG]+$/.test(seq)) {
        notify("Please enter a valid DNA sequence (A,T,C,G only)", "alert");
        return;
    }
    
    let elems = structureFactory.createStapleConnector(seq);
    if (elems && elems.length > 0) {
        api.selectElements(elems);
        topologyEdited = true;
    }
}

function createTensegrityTriangleWrapper() {
    let edgeLength = parseInt((document.getElementById('ttEdgeLength') as HTMLInputElement).value);
    if (isNaN(edgeLength) || edgeLength < 2) {
        notify("Please enter a valid edge length (>= 2)", "alert");
        return;
    }
    
    let elems = structureFactory.createTensegrityTriangle(edgeLength);
    if (elems && elems.length > 0) {
        api.selectElements(elems);
        topologyEdited = true;
    }
}

function createDXLatticeWrapper() {
    let rows = parseInt((document.getElementById('dxlRows') as HTMLInputElement).value);
    let cols = parseInt((document.getElementById('dxlCols') as HTMLInputElement).value);
    let tileLength = parseInt((document.getElementById('dxlTileLength') as HTMLInputElement).value);
    
    if (isNaN(rows) || rows < 1 || isNaN(cols) || cols < 1) {
        notify("Please enter valid row and column counts (>= 1)", "alert");
        return;
    }
    if (isNaN(tileLength) || tileLength < 4) {
        notify("Please enter a valid tile length (>= 4)", "alert");
        return;
    }
    
    let elems = structureFactory.createDXLattice(rows, cols, tileLength);
    if (elems && elems.length > 0) {
        api.selectElements(elems);
        topologyEdited = true;
    }
}