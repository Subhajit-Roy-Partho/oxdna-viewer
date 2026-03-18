/// <reference path="../typescript_definitions/index.d.ts" />

declare var STLExporter: any;

function saveSTL(
	name: string,
	include_backbone: boolean, include_nucleoside: boolean,
	include_connector: boolean, include_bbconnector: boolean,
	backboneScale: number, nucleosideScale: number,
	connectorScale: number, bbconnectorScale: number,
	faces_mul: number
) {
	console.log('Note: The mesh accuracy is set down because js has a limitation on the string length.');
	console.log('on large scenes play with the included objects');

	const exporter = new STLExporter();
	const exportRoot = new THREE.Scene();
	const objects = exportGLTF(
		systems,
		include_backbone, include_nucleoside,
		include_connector, include_bbconnector,
		backboneScale, nucleosideScale,
		connectorScale, bbconnectorScale,
		faces_mul, true
	);

	objects.forEach(object => {
		exportRoot.add(object.parent ? object.clone(true) : object);
	});

	const stlString = exporter.parse(exportRoot);
	makeTextFile(name + '.stl', stlString);
}
