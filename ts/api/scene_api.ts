/**
 * Bits of code to facilitate querying structures from the browser console
 */
type ApiErrorRecord = {
    namespace: string;
    method: string;
    message: string;
    stack?: string;
    timestamp: string;
    args: string[];
};

const API_ERROR_RECORD_KEY = '__oxviewApiErrorRecord';

module api{
    let lastErrorRecord: ApiErrorRecord = null;
    let errorHistory: ApiErrorRecord[] = [];

    function serializeApiArgument(arg: any): string {
        if (arg === undefined) {
            return 'undefined';
        }
        if (arg === null) {
            return 'null';
        }
        if (arg instanceof THREE.Vector3 || arg instanceof THREE.Vector4) {
            return JSON.stringify(arg.toArray());
        }
        if (arg instanceof THREE.Color) {
            return `Color(${arg.getHexString()})`;
        }
        if (arg instanceof Set) {
            return `Set(${arg.size})`;
        }
        if (arg instanceof Map) {
            return `Map(${arg.size})`;
        }
        if (Array.isArray(arg)) {
            return `Array(${arg.length})`;
        }
        if (arg instanceof BasicElement) {
            return `BasicElement(${arg.id})`;
        }
        if (arg instanceof Strand) {
            return `Strand(${arg.id})`;
        }
        if (arg instanceof System) {
            return `System(${arg.id})`;
        }
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (error) {
                return Object.prototype.toString.call(arg);
            }
        }
        return String(arg);
    }

    function normalizeApiError(error: any): Error {
        if (error instanceof Error) {
            return error;
        }
        return new Error(String(error));
    }

    export function getLastError(): ApiErrorRecord {
        if (!lastErrorRecord) {
            return null;
        }
        return Object.assign({}, lastErrorRecord, { args: lastErrorRecord.args.slice() });
    }

    export function clearLastError(): void {
        lastErrorRecord = null;
        (window as any).lastAPIError = null;
    }

    export function getErrorHistory(): ApiErrorRecord[] {
        return errorHistory.map(record => Object.assign({}, record, { args: record.args.slice() }));
    }

    export function clearErrorHistory(): void {
        errorHistory = [];
        clearLastError();
        (window as any).apiErrorHistory = [];
    }

    export function reportError(namespaceName: string, methodName: string, error: any, args: any[] = []): ApiErrorRecord {
        if (error && typeof error === 'object' && error[API_ERROR_RECORD_KEY]) {
            return error[API_ERROR_RECORD_KEY];
        }

        const normalized = normalizeApiError(error);
        const record: ApiErrorRecord = {
            namespace: namespaceName,
            method: methodName,
            message: normalized.message,
            stack: normalized.stack,
            timestamp: new Date().toISOString(),
            args: args.map(serializeApiArgument)
        };

        if (normalized && typeof normalized === 'object') {
            normalized[API_ERROR_RECORD_KEY] = record;
        }

        lastErrorRecord = record;
        errorHistory.push(record);
        if (errorHistory.length > 50) {
            errorHistory.shift();
        }

        (window as any).lastAPIError = record;
        (window as any).apiErrorHistory = errorHistory;

        const message = `${namespaceName}.${methodName} failed: ${record.message}`;
        if (typeof notify === 'function') {
            notify(message, 'alert', true);
        }
        console.error(message, normalized, { args });

        return record;
    }

    export function wrapNamespaceErrors(target: any, namespaceName: string, skip: string[] = []) {
        const skipped = new Set([
            'getLastError',
            'clearLastError',
            'getErrorHistory',
            'clearErrorHistory',
            'reportError',
            'wrapNamespaceErrors',
            ...skip
        ]);

        Object.keys(target).forEach(key => {
            if (skipped.has(key)) {
                return;
            }

            const value = target[key];
            if (typeof value !== 'function') {
                return;
            }

            if (value.__oxviewApiWrapped) {
                return;
            }

            // Uppercase exports in api.observable are classes; leave them untouched.
            if (key.length > 0 && key[0] === key[0].toUpperCase()) {
                return;
            }

            const wrapped = function () {
                try {
                    const result = value.apply(this, arguments);
                    if (result && typeof result.then === 'function') {
                        return result.catch(error => {
                            reportError(namespaceName, key, error, Array.from(arguments));
                            throw error;
                        });
                    }
                    return result;
                } catch (error) {
                    reportError(namespaceName, key, error, Array.from(arguments));
                    throw error;
                }
            };

            wrapped.__oxviewApiWrapped = true;
            target[key] = wrapped;
        });
    }

    function getInstancePositionIfAvailable(element: BasicElement, parameter: string): THREE.Vector3 | null {
        try {
            return element.getInstanceParameter3(parameter);
        } catch (error) {
            return null;
        }
    }

    function resolveElementPositionTarget(element: BasicElement, target: string): THREE.Vector3 | null {
        switch ((target || 'center').toLowerCase()) {
            case 'center':
            case 'position':
            case 'cm':
                return element.getPos();
            case 'backbone':
            case 'bb':
                return getInstancePositionIfAvailable(element, 'bbOffsets');
            case 'base':
            case 'nucleoside':
            case 'ns':
                return getInstancePositionIfAvailable(element, 'nsOffsets');
            case 'connector':
            case 'con':
                return getInstancePositionIfAvailable(element, 'conOffsets');
            case 'backboneconnector':
            case 'bbconnector':
            case 'sp':
                return getInstancePositionIfAvailable(element, 'bbconOffsets');
            default:
                throw new Error(`Unknown position target "${target}". Use center, backbone, base, connector, or backboneConnector.`);
        }
    }

    /**
     * Toggles the visibility of a strand.
     * @param strand The strand to toggle
     * @returns The strand
     */
    export function toggleStrand(strand: Strand): Strand{
        strand.map( 
            (n:Nucleotide) => n.toggleVisibility());

        strand.system.callUpdates(['instanceVisibility'])
        if (tmpSystems.length > 0) {
            tmpSystems.forEach(s => s.callUpdates(['instanceVisibility']));
        }

        render();
        return strand;
    }

    /**
     * Selects and highlights the entire strand.
     * @param strand The strand to mark
     * @param keepPrevious Whether to keep the previous selection
     * @returns The strand
     */
    export function markStrand(strand: Strand, keepPrevious = true): Strand {
        selectElements(strand.getMonomers(), keepPrevious);
        return strand;
    }

    // get a dictionary with every strand length : [strand] listed   
    /**
     * Get a dictionary with every strand length : [strand] listed.
     * @param system The system to query
     * @returns Dictionary of strand lengths
     */
    export function countStrandLength(system = systems[0]) {
        let strandLength : { [index: number]: [Strand] } = {};
        system.strands.map((strand: Strand) => {
            let l = strand.getLength();
            if (l in strandLength) 
                strandLength[l].push(strand);
            else
                strandLength[l] = [strand];
        });
        return strandLength;  
    };

    //highlight
    /**
     * Highlights the 5' ends of strands in the system.
     * @param system The system to highlight
     */
    export function highlight5ps(system = systems[0]){
        system.strands.forEach(strand=>strand.end5.select());
        updateView(system);
        render();
    }

    //highlight
    /**
     * Highlights the 3' ends of strands in the system.
     * @param system The system to highlight
     */
    export function highlight3ps(system = systems[0]){
        system.strands.forEach(strand=>strand.end3.select());
        updateView(system);
        render();
    }

    /**
     * Show geometries to mark 3' ends
     * @param enable Set to true to show markers, false to hide them
     * @param diameter Marker diameter
     * @param length Marker length
     * @param spacing Distance from backbone sphere
     */
    export function update3primeMarkers(diameter: number, length: number, spacing: number) {
        systems.forEach(sys=>{
            sys.strands.forEach(s=>view.update3pMarker(
                s.end3, diameter, length, spacing
            ));
            //updateView(sys);
        });
        render();
    }

    /**
     * Toggles the visibility of a list of elements.
     * @param elems List of elements to toggle
     */
    export function toggleElements(elems: BasicElement[]) {
        let sys = new Set<System>();
        let tmpSys = new Set<System>();
        elems.forEach(e=>{
            e.toggleVisibility();
            sys.add(e.getSystem());
            if (e.dummySys) {
                tmpSys.add(e.dummySys);
            }
        });
        sys.forEach(s=>s.callUpdates(['instanceVisibility']));
        tmpSys.forEach(s=>s.callUpdates(['instanceVisibility']));
        render();
    }

    /**
     * Toggles the visibility of all elements in the system.
     * @param system The system to toggle
     */
    export function toggleAll(system = systems[0]){
        system.strands.forEach(strand=>strand.forEach(n => n.toggleVisibility()));
        system.callUpdates(['instanceVisibility'])
        if (tmpSystems.length > 0) {
            tmpSystems.forEach ((s) => {
                s.callUpdates(['instanceVisibility'])
            })
        }
        render();
    }

    //toggles the nuceloside colors on and off
    /**
     * Toggles the nucleoside colors on and off (switching between element color and grey).
     */
    export function toggleBaseColors() {
        elements.forEach(
            (e: BasicElement) => {
                if (e.strand == null) return
                let sys = e.getSystem();
                let sid = e.sid;
                if (e.dummySys !== null) {
                    sys = e.dummySys
                    sid = e.sid;
                }
                //because the precision of the stored color value (32-bit) and defined color value (64-bit) are different,
                //you have to do some weird casting to get them to be comparable.
                let tmp = e.getInstanceParameter3("nsColors") //maybe this shouldn't be a vector3...
                let c = [tmp.x.toPrecision(6), tmp.y.toPrecision(6), tmp.z.toPrecision(6)];
                let g = [GREY.r.toPrecision(6), GREY.g.toPrecision(6), GREY.b.toPrecision(6)];
                if (JSON.stringify(c)==JSON.stringify(g)){
                    let newC = e.elemToColor(e.type);
                    sys.fillVec('nsColors', 3, sid, [newC.r, newC.g, newC.b])
                }
                else {
                    sys.fillVec('nsColors', 3, sid,[GREY.r, GREY.g, GREY.b]);
                }
            }
        )
        for (let i = 0; i < systems.length; i++) {
            systems[i].nucleoside.geometry["attributes"].instanceColor.needsUpdate = true;
        }
        if (tmpSystems.length > 0) {
            tmpSystems.forEach ((s) => {
                s.nucleoside.geometry["attributes"].instanceColor.needsUpdate = true;
            })
        }
        render();
    }
    
    /**
     * Traces elements from 5' to 3' starting from the given element.
     * @param element The starting element
     * @returns Array of elements
     */
    export function trace53(element: BasicElement): BasicElement[]{
        let elems : BasicElement[] = [];
        let c : BasicElement = element; 
        while(c){
            elems.push(c);
            c = c.n3;
        }
        return elems;
    }

    /**
     * Traces elements from 3' to 5' starting from the given element.
     * @param element The starting element
     * @returns Array of elements
     */
    export function trace35(element: BasicElement): BasicElement[]{
        let elems : BasicElement[] = [];
        let c : BasicElement = element; 
        while(c){
            elems.push(c);
            c = c.n5;
        }
        return elems;
    }

    /**
     * Gets elements by their IDs.
     * @param targets Array of element IDs
     * @returns Array of elements
     */
    export function getElements(targets: number[]): BasicElement[] {
        let out = [];
        targets.forEach((n) => {
            let elem = elements.get(n);
            if (elem) {
                out.push(elements.get(n));
            }
            else {
                notify("ElementID " + n + " out of range.");
            }
        });
        return(out);
    }

    /**
     * Gets a single element by global ID.
     * @param target Global element ID
     * @returns The element or undefined if not found
     */
    export function getElement(target: number): BasicElement | undefined {
        return elements.get(target);
    }

    /**
     * Gets the sequence for a strand.
     * @param strand The strand to query
     * @returns Sequence string
     */
    export function getSequence(strand: Strand): string {
        return strand.getSequence();
    }

    /**
     * Returns a copy of the selected elements.
     * @returns Selected elements
     */
    export function getSelectedBases(): BasicElement[] {
        return Array.from(selectedBases);
    }

    /**
     * Returns the global IDs of the selected elements.
     * @returns Selected element IDs
     */
    export function getSelectedElementIDs(): number[] {
        return getSelectedBases().map(e => e.id);
    }

    /**
     * Gets a position from an element.
     * @param element Element to inspect
     * @param target Which position to return: center, backbone, base, connector, backboneConnector
     * @returns Position vector or null if that position is not meaningful for this element
     */
    export function getElementPosition(element: BasicElement, target = 'center'): THREE.Vector3 | null {
        const position = resolveElementPositionTarget(element, target);
        return position ? position.clone() : null;
    }

    /**
     * Convenience alias for nucleoside/base position.
     * @param element Element to inspect
     * @returns Base position vector or null
     */
    export function getBasePosition(element: BasicElement): THREE.Vector3 | null {
        return getElementPosition(element, 'base');
    }

    /**
     * Convenience alias for backbone position.
     * @param element Element to inspect
     * @returns Backbone position vector or null
     */
    export function getBackbonePosition(element: BasicElement): THREE.Vector3 | null {
        return getElementPosition(element, 'backbone');
    }

    /**
     * Gets positions for a list of elements.
     * @param elems Elements to inspect
     * @param target Which position to return
     * @returns Array of positions matching the provided elements
     */
    export function getElementPositions(elems: BasicElement[], target = 'center'): (THREE.Vector3 | null)[] {
        return elems.map(e => getElementPosition(e, target));
    }

    /**
     * Gets the orientation vectors for an element.
     * @param element Element to inspect
     * @returns Orientation vectors
     */
    export function getElementOrientation(element: BasicElement) {
        const a1 = element.getA1().clone();
        const a3 = element.getA3().clone();
        const a2 = a1.clone().cross(a3);
        if (a2.lengthSq() > 0) {
            a2.normalize();
        }
        return { a1, a2, a3 };
    }

    /**
     * Gets a serializable info object for an element.
     * @param element Element to inspect
     * @returns Information about the element
     */
    export function getElementInfo(element: BasicElement) {
        const orientation = getElementOrientation(element);
        const pairId = element.isPaired() && (element as Nucleotide).pair ? (element as Nucleotide).pair.id : null;
        const positions = {
            center: getElementPosition(element, 'center')?.toArray() ?? null,
            backbone: getElementPosition(element, 'backbone')?.toArray() ?? null,
            base: getElementPosition(element, 'base')?.toArray() ?? null,
            connector: getElementPosition(element, 'connector')?.toArray() ?? null,
            backboneConnector: getElementPosition(element, 'backboneConnector')?.toArray() ?? null,
        };

        return {
            id: element.id,
            sid: element.sid,
            type: element.type,
            label: element.label ?? null,
            systemId: element.getSystem().id,
            strandId: element.strand ? element.strand.id : null,
            clusterId: element.clusterId ?? null,
            selected: selectedBases.has(element),
            paired: element.isPaired(),
            pairId,
            n3Id: element.n3 ? element.n3.id : null,
            n5Id: element.n5 ? element.n5.id : null,
            positions,
            orientation: {
                a1: orientation.a1.toArray(),
                a2: orientation.a2.toArray(),
                a3: orientation.a3.toArray(),
            }
        };
    }

    /**
     * Gets the center of mass of a list of elements.
     * @param elems Elements to average. Defaults to the current selection.
     * @param target Which position to average
     * @returns Center of mass vector
     */
    export function getCenterOfMass(elems = getSelectedBases(), target = 'center'): THREE.Vector3 {
        const positions = elems
            .map(e => getElementPosition(e, target))
            .filter((p): p is THREE.Vector3 => !!p);
        const center = new THREE.Vector3();
        if (positions.length === 0) {
            return center;
        }
        positions.forEach(p => center.add(p));
        return center.divideScalar(positions.length);
    }

    /**
     * Gets the distance between two elements.
     * @param a First element
     * @param b Second element
     * @param target Which position to compare
     * @returns Distance or NaN if that position is not available
     */
    export function getDistance(a: BasicElement, b: BasicElement, target = 'center'): number {
        const pa = getElementPosition(a, target);
        const pb = getElementPosition(b, target);
        if (!pa || !pb) {
            return NaN;
        }
        return pa.distanceTo(pb);
    }

    /**
     * Selects elements by their IDs.
     * @param targets Array of element IDs
     * @param keepPrevious Whether to keep previous selection
     */
    export function selectElementIDs(targets: number[], keepPrevious?: boolean) {
        selectElements(getElements(targets), keepPrevious);
    }

    /**
     * Selects elements by their PDB IDs.
     * @param targetPDBNumber Array of PDB numbers
     * @param chainids Array of chain IDs
     * @param keepPrevious Whether to keep previous selection
     */
    export function selectPDBIDs(targetPDBNumber: number[], chainids?: string[], keepPrevious?: boolean) {
        if (!keepPrevious) {
            clearSelection();
        }
        if(chainids == undefined){
            for (let i = 0; i < targetPDBNumber.length; i++) {
                elements.forEach((e, idx) => {
                    if (e.isAminoAcid()) {
                        let f = <AminoAcid>e;
                        if (parseInt(f.pdbindices[2]) == targetPDBNumber[i]) {
                            selectElements([e], true);
                        }
                    }
                })
            }
        } else {
            if (chainids.length == 0 && chainids.length != targetPDBNumber.length) notify("Please provide both residue and PDB number for all queries");
            for (let i = 0; i < targetPDBNumber.length; i++) {
                elements.forEach((e, idx) => {
                    if (e.isAminoAcid()) {
                        let f = <AminoAcid>e;
                        if (chainids.length != 0 && parseInt(f.pdbindices[2]) == targetPDBNumber[i]) {
                            if (chainids[i] == f.pdbindices[1]) {
                                selectElements([e], true);
                            }
                        }
                    }
                })
            }
        }
        if(selectedBases.size == 0){
            notify("No Matching PDB Identifiers Found");
        }
    }

    /**
     * Show the specified element in the viewport
     * @param element Element to center view at
     */
    export function findElement(element: BasicElement, steps=20) {
        let targetPos: THREE.Vector3;
        if (element.isNucleotide()) {
            targetPos = element.getInstanceParameter3('bbOffsets');
        } else {
            targetPos = element.getPos()
        }

        // Target trackball controls at element position
        //controls.target = targetPos;

        // Move in close to the element
        let targetDist = 10;
        let dist = (camera.position.distanceTo(targetPos));

        let endPos = camera.position.clone().sub(targetPos).setLength(targetDist).add(targetPos);

        if (steps > 1) {
            camera.position.lerp(endPos, 1/steps);
            controls.target.lerp(targetPos, 1/steps);
        } else {
            camera.position.lerp(endPos, 1-(targetDist/dist));
            controls.target = targetPos;
        }

        if (steps > 1) {
            requestAnimationFrame(()=>{
                api.findElement(element, steps-1);
            });
        }
    }

    /**
     * Selects a list of elements.
     * @param elems List of elements to select
     * @param keepPrevious Whether to keep previous selection
     */
    export function selectElements(elems: BasicElement[], keepPrevious?: boolean) {
        if (!keepPrevious) {
            clearSelection();
        }
        elems.forEach(e => {
            if (!selectedBases.has(e)) {
                e.toggle();
            }
        });
        systems.forEach(sys => {
            updateView(sys);
        });
        if (selectedBases.size > 0 && view.transformMode.enabled()) {
            transformControls.show();
        }
        render()
    }
    
    //there's probably a less blunt way to do this...
    /**
     * Removes the colorbar from the scene.
     */
    export function removeColorbar() {
        let l = colorbarScene.children.length;
        for (let i = 0; i < l; i++) {
            if (colorbarScene.children[i].type == "Sprite" || colorbarScene.children[i].type == "Line") {
                colorbarScene.remove(colorbarScene.children[i]);
                i -= 1;
                l -= 1;
            }
        }
        colorbarScene.remove(lut.legend.mesh)
        //reset light to default
        pointlight.intensity = 1.1;
        renderColorbar();
    }

    //turns out that lut doesn't save the sprites so you have to completley remake it
    /**
     * Shows the colorbar in the scene.
     */
    export function showColorbar() {
        colorbarScene.add(lut.legend.mesh);
        let notation, decimal;
        lut.maxV - lut.minV > 0.09 ? notation = 'decimal' : notation = 'scientific';
        notation == 'scientific' ? decimal = 1 : decimal = 2
        let labels =  lut.setLegendLabels({'title':lut.legend.labels.title, 'ticks':lut.legend.labels.ticks, 'notation':notation, 'decimal':decimal}); //don't ask, lut stores the values but doesn't actually save the sprites anywhere so you have to make them again...
        colorbarScene.add(labels["title"]);
        for (let i = 0; i < Object.keys(labels['ticks']).length; i++) {
            colorbarScene.add(labels['ticks'][i]);
            colorbarScene.add(labels['lines'][i]);
        }
        //colormap doesn't look right unless the light is 100%
        pointlight.intensity = 1.0; 

        renderColorbar();
    }

    /**
     * Changes the colormap used for visualization.
     * @param name Name of the colormap
     */
    export function changeColormap(name: string) {
        if (lut != undefined) {
            api.removeColorbar();
            let key = lut.legend.labels.title;
            let min = lut.minV;
            let max = lut.maxV;
            let notation, decimal;
            lut = lut.changeColorMap(name);
            console.log(max-min);
            max - min > 0.09 ? notation='decimal' : notation='scientific'; //if max and min are too close together, nothing shows up.
            notation == 'scientific' ? decimal = 1 : decimal = 2 //scientific notation is too big for the colorbar scene, so make it smaller.
            lut.setMax(max);
            lut.setMin(min);
            lut.setLegendOn({ 'layout': 'horizontal', 'position': { 'x': 0, 'y': 0, 'z': 0 }, 'dimensions': { 'width': 2, 'height': 12 } }); //create legend
            lut.setLegendLabels({ 'title': key, 'ticks': 5, 'notation':notation, 'decimal':decimal });
            for (let i = 0; i < systems.length; i++){
                let system = systems[i];
                let end = system.systemLength()
                for (let i = 0; i < end; i++) { //insert lut colors into lutCols[] to toggle Lut coloring later
                    system.lutCols[i] = lut.getColor(Number(system.colormapFile[key][i]));
                }
            }
            updateColoring();
        }
        else {
            defaultColormap = name;
        }
    }

    /**
     * Sets the bounds for the color mapping.
     * @param min Minimum value
     * @param max Maximum value
     */
    export function setColorBounds(min: number, max: number) {
        let key = lut.legend.labels.title;
        lut.setMax(max);
        lut.setMin(min);
        api.removeColorbar();
        lut.setLegendOn({ 'layout': 'horizontal', 'position': { 'x': 0, 'y': 0, 'z': 0 }, 'dimensions': { 'width': 2, 'height': 12 } }); //create legend
        lut.setLegendLabels({ 'title': key, 'ticks': 5 });
        for (let i = 0; i < systems.length; i++){
            let system = systems[i];
            let end = system.systemLength()
            for (let i = 0; i < end; i++) { //insert lut colors into lutCols[] to toggle Lut coloring later
                system.lutCols[i] = lut.getColor(Number(system.colormapFile[key][i]));
            }
        }
        updateColoring();
    }

    /**
     * Shows only sugar-phosphate/backbone connector cylinders.
     */
    export function spOnly() {
        elements.forEach((n: BasicElement) => {
            n.setInstanceParameter('scales', [0, 0, 0]);
            n.setInstanceParameter('nsScales', [0, 0, 0]);
            n.setInstanceParameter('conScales', [0, 0, 0]);
        });
        for (let i = 0; i < systems.length; i++) {
            systems[i].callUpdates(['instanceScale']);
        }
        for (let i = 0; i < tmpSystems.length; i++) {
            tmpSystems[i].callUpdates(['instanceScale']);
        }
        render();
    }

    /**
     * Resets the visualization to show everything with default scaling.
     */
    export function showEverything() {
        elements.forEach((n: BasicElement) => {
            n.setInstanceParameter('scales', [1, 1, 1]);
            n.setInstanceParameter('nsScales', [0.7, 0.3, 0.7]);
            n.setInstanceParameter('conScales', [1, n.bbnsDist, 1]);
        });
        for (let i = 0; i < systems.length; i++) {
            systems[i].callUpdates(['instanceScale'])
        }
        for (let i = 0; i < tmpSystems.length; i++) {
            tmpSystems[i].callUpdates(['instanceScale'])
        }
        render();
    }

    /**
     * Switches between Perspective and Orthographic camera modes.
     */
    export function switchCamera() {
        if (camera instanceof THREE.PerspectiveCamera) {
            //get camera parameters
            const far = camera.far;
            const near = camera.near;
            const focus = controls.target;
            const fov = camera.fov*Math.PI/180; //convert to radians
            const pos = camera.position;
            let width = 2*Math.tan(fov/2)*focus.distanceTo(pos);
            let height = width/camera.aspect;
            const up = camera.up;
            const quat = camera.quaternion;
            let cameraHeading = new THREE.Vector3(0, 0, -1);
            cameraHeading.applyQuaternion(quat);

            //if the camera is upside down, you need to flip the corners of the orthographic box
            if (quat.dot(refQ) < 0 && quat.w > 0) {
                width *= -1;
                height *= -1;
            }
    
            //create a new camera with same properties as old one
            let newCam = createOrthographicCamera(-width/2, width/2, height/2, -height/2, near, far, pos.toArray());
            newCam.up = up
            newCam.lookAt(focus);
            scene.remove(camera);
            camera = newCam;
            controls.object = camera;
            transformControls.camera = camera;
            scene.add(camera);

            document.getElementById("cameraSwitch").innerHTML = "Perspective";
        }
        else if (camera instanceof THREE.OrthographicCamera) {
            //get camera parameters
            const far = camera.far;
            const near = camera.near;
            const focus = controls.target;
            const pos = camera.position;
            const up = camera.up;
            let fov = 2*Math.atan((((camera.right-camera.left)/2))/focus.distanceTo(pos))*180/Math.PI;
            
            //if the camera is upside down, you need to flip the fov for the perspective camera
            if (camera.left > camera.right) {
                fov *= -1
            }

            //create a new camera with same properties as old one
            let newCam = createPerspectiveCamera(fov, near, far, pos.toArray());
            newCam.up = up;
            newCam.lookAt(focus);
            scene.remove(camera);
            camera = newCam;
            controls.object = camera;
            transformControls.camera = camera;
            scene.add(camera);

            document.getElementById("cameraSwitch").innerHTML = "Orthographic";
        }
        render();
    }

    //export function flipConnectors() {
    //    instancedBBconnector.
    //}
}

api.wrapNamespaceErrors(api, 'api');
