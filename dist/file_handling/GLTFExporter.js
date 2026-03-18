/// <reference path="../typescript_definitions/index.d.ts" />
function exportGLTF(systems, include_backbone, include_nucleoside, include_connector, include_bbconnector, backboneScale, nucleosideScale, connectorScale, bbconnectorScale, faces_mul, flattenHierarchy, nsRoughness = 0.2, bbRoughness = 0.2, nsMetalness = 0, bbMetalness = 0) {
    const backbone = new THREE.SphereGeometry(.2 * backboneScale, 10 * faces_mul, 10 * faces_mul);
    const nucleoside = new THREE.SphereGeometry(.3 * nucleosideScale, 10 * faces_mul, 10 * faces_mul);
    const connector = new THREE.CylinderGeometry(.1 * connectorScale, .1 * connectorScale, 1, 8 * faces_mul);
    const bbConnector = new THREE.CylinderGeometry(.02 * bbconnectorScale, .1 * bbconnectorScale, 1, 8 * faces_mul);
    const materialMap = new Map();
    const getMaterial = (hex, roughness, metalness) => {
        if (!materialMap.has(hex)) {
            materialMap.set(hex, new THREE.MeshStandardMaterial({
                color: hex,
                roughness,
                metalness
            }));
        }
        return materialMap.get(hex);
    };
    const handleElement = (e) => {
        const elemObj = new THREE.Group();
        const bbOffsets = e.getInstanceParameter3('bbOffsets');
        const nsOffsets = e.getInstanceParameter3('nsOffsets');
        const nsRotation = e.getInstanceParameter4('nsRotation');
        const conOffsets = e.getInstanceParameter3('conOffsets');
        const conRotation = e.getInstanceParameter4('conRotation');
        const bbconOffsets = e.getInstanceParameter3('bbconOffsets');
        const bbconRotation = e.getInstanceParameter4('bbconRotation');
        const nsScales = e.getInstanceParameter3('nsScales');
        const conScales = e.getInstanceParameter3('conScales');
        const bbconScales = e.getInstanceParameter3('bbconScales');
        const nsColor = new THREE.Color().fromArray(e.getInstanceParameter3('nsColors').toArray()).getHex();
        const bbColor = new THREE.Color().fromArray(e.getInstanceParameter3('bbColors').toArray()).getHex();
        if (include_backbone) {
            const backboneMesh = new THREE.Mesh(backbone, getMaterial(bbColor, bbRoughness, bbMetalness));
            backboneMesh.position.copy(bbOffsets);
            backboneMesh.name = `backbone_${e.id}`;
            elemObj.add(backboneMesh);
        }
        if (include_nucleoside) {
            const nucleosideMesh = new THREE.Mesh(nucleoside, getMaterial(nsColor, nsRoughness, nsMetalness));
            nucleosideMesh.scale.copy(nsScales);
            nucleosideMesh.quaternion.copy(glsl2three(nsRotation));
            nucleosideMesh.position.copy(nsOffsets);
            nucleosideMesh.name = `nucleoside_${e.id}`;
            elemObj.add(nucleosideMesh);
        }
        if (include_connector) {
            const connectorMesh = new THREE.Mesh(connector, getMaterial(bbColor, bbRoughness, bbMetalness));
            connectorMesh.scale.copy(conScales);
            connectorMesh.quaternion.copy(glsl2three(conRotation));
            connectorMesh.position.copy(conOffsets);
            connectorMesh.name = `connector_${e.id}`;
            elemObj.add(connectorMesh);
        }
        if (include_bbconnector) {
            const bbconnectorMesh = new THREE.Mesh(bbConnector, getMaterial(bbColor, bbRoughness, bbMetalness));
            bbconnectorMesh.scale.copy(bbconScales);
            bbconnectorMesh.quaternion.copy(glsl2three(bbconRotation));
            bbconnectorMesh.position.copy(bbconOffsets);
            bbconnectorMesh.name = `bbconnector_${e.id}`;
            elemObj.add(bbconnectorMesh);
        }
        elemObj.name = `element_${e.id}`;
        return elemObj;
    };
    const getExtraExportObjects = () => {
        const excluded = new Set();
        systems.forEach(system => {
            [
                system.backbone,
                system.nucleoside,
                system.connector,
                system.bbconnector,
                system.dummyBackbone
            ].forEach(object => {
                if (object) {
                    excluded.add(object);
                }
            });
        });
        if (boxObj) {
            excluded.add(boxObj);
        }
        if (transformControlsHelper) {
            excluded.add(transformControlsHelper);
        }
        return scene.children.filter(object => {
            const exportObject = object;
            return (!excluded.has(object) &&
                !exportObject.isLight &&
                !exportObject.isCamera &&
                object.name !== 'x-axis' &&
                object.name !== 'y-axis' &&
                object.name !== 'z-axis');
        });
    };
    if (flattenHierarchy) {
        const exportedObjects = [];
        elements.forEach(e => {
            if (!systems.includes(e.getSystem())) {
                return;
            }
            const elemObj = handleElement(e);
            while (elemObj.children.length > 0) {
                const mesh = elemObj.children[0];
                elemObj.remove(mesh);
                exportedObjects.push(mesh);
            }
        });
        getExtraExportObjects().forEach(object => exportedObjects.push(object));
        return exportedObjects;
    }
    return systems.map(system => {
        const sysObj = new THREE.Group();
        system.strands.forEach(strand => {
            const strandObj = new THREE.Group();
            strand.forEach(e => strandObj.add(handleElement(e)));
            strandObj.name = `strand_${strand.id}`;
            sysObj.add(strandObj);
        });
        sysObj.name = `system_${system.id}`;
        return sysObj;
    });
}
