const INSTANCED_ATTRIBUTE_HEADER = `
#ifdef INSTANCED
attribute vec3 instanceOffset;
attribute vec4 instanceRotation;
attribute vec3 instanceColor;
attribute vec3 instanceScale;
attribute vec3 instanceVisibility;
vec3 rotateVector( vec4 quat, vec3 vec ) {
	return vec + 2.0 * cross( cross( vec, quat.xyz ) + quat.w * vec, quat.xyz );
}
#endif
`;

function patchInstancedVertexShader(shader: THREE.Shader) {
	shader.vertexShader = shader.vertexShader
		.replace(
			'#include <common>',
			`#include <common>\n${INSTANCED_ATTRIBUTE_HEADER}`
		)
		.replace(
			'#include <color_vertex>',
			`#include <color_vertex>
#ifdef INSTANCED
	#ifdef USE_COLOR
		vColor.xyz = instanceColor.xyz;
	#endif
#endif`
		)
		.replace(
			'#include <defaultnormal_vertex>',
			`#include <defaultnormal_vertex>
#ifdef INSTANCED
	transformedNormal = normalMatrix * rotateVector( instanceRotation, objectNormal );
#endif`
		)
		.replace(
			'#include <begin_vertex>',
			`#include <begin_vertex>
#ifdef INSTANCED
	transformed *= instanceScale * instanceVisibility;
	transformed = rotateVector( instanceRotation, transformed );
	transformed += instanceOffset;
#endif`
		);
}

function configureInstancedMaterial<T extends THREE.Material>(material: T): T {
	const originalOnBeforeCompile = material.onBeforeCompile;
	const originalProgramCacheKey = material.customProgramCacheKey?.bind(material);

	(material as any).vertexColors = true;
	material.defines = material.defines || {};
	material.defines.INSTANCED = '';

	material.onBeforeCompile = (shader: THREE.Shader, renderer?: THREE.WebGLRenderer) => {
		if (originalOnBeforeCompile) {
			originalOnBeforeCompile.call(material, shader, renderer);
		}
		patchInstancedVertexShader(shader);
	};

	material.customProgramCacheKey = () => {
		const baseKey = originalProgramCacheKey ? originalProgramCacheKey() : material.type;
		return `oxview-instanced:${baseKey}`;
	};

	material.needsUpdate = true;
	return material;
}

function createInstancedDepthMaterial() {
	const material = new THREE.MeshDepthMaterial();
	material.defines = material.defines || {};
	material.defines.INSTANCED = '';
	material.onBeforeCompile = (shader: THREE.Shader) => {
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\n${INSTANCED_ATTRIBUTE_HEADER}`
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
#ifdef INSTANCED
	transformed *= instanceScale * instanceVisibility;
	transformed = rotateVector( instanceRotation, transformed );
	transformed += instanceOffset;
#endif`
			);
	};
	material.customProgramCacheKey = () => 'oxview-instanced-depth';
	return material;
}

function createInstancedDistanceMaterial() {
	const material = new THREE.MeshDistanceMaterial();
	material.defines = material.defines || {};
	material.defines.INSTANCED = '';
	material.onBeforeCompile = (shader: THREE.Shader) => {
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`#include <common>\n${INSTANCED_ATTRIBUTE_HEADER}`
			)
			.replace(
				'#include <begin_vertex>',
				`#include <begin_vertex>
#ifdef INSTANCED
	transformed *= instanceScale * instanceVisibility;
	transformed = rotateVector( instanceRotation, transformed );
	transformed += instanceOffset;
#endif`
			);
	};
	material.customProgramCacheKey = () => 'oxview-instanced-distance';
	return material;
}

const instancedDepthMaterial = createInstancedDepthMaterial();
const instancedDistanceMaterial = createInstancedDistanceMaterial();

function applyInstancedDepthMaterials(mesh: THREE.Mesh) {
	mesh.customDepthMaterial = instancedDepthMaterial;
	mesh.customDistanceMaterial = instancedDistanceMaterial;
}

const pickingScene = new THREE.Scene();
const pickingTexture = new THREE.WebGLRenderTarget(1, 1);

pickingTexture.texture.minFilter = THREE.LinearFilter;
pickingTexture.texture.magFilter = THREE.NearestFilter;
pickingTexture.texture.generateMipmaps = false;

function syncPickingTextureSize() {
	const width = renderer.domElement.width || window.innerWidth;
	const height = renderer.domElement.height || window.innerHeight;
	pickingTexture.setSize(width, height);
}

syncPickingTextureSize();

const vs3D = `
attribute vec3 instanceColor;
attribute vec3 instanceVisibility;
attribute vec3 instanceOffset;
varying vec3 vinstanceColor;

void main() {
	vinstanceColor = instanceColor;
	vec3 pos = position + instanceOffset;
	pos *= instanceVisibility;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( pos, 1.0 );
}`;

const fs3D = `
varying vec3 vinstanceColor;

void main() {
	gl_FragColor = vec4( vinstanceColor, 1.0 );
}`;

const pickingMaterial = new THREE.ShaderMaterial({
	vertexShader: vs3D,
	fragmentShader: fs3D
});

function gpuPicker(event): number {
	syncPickingTextureSize();
	renderer.setRenderTarget(pickingTexture);
	renderer.render(pickingScene, camera);

	const rect = renderer.domElement.getBoundingClientRect();
	const x = Math.max(0, Math.min(
		pickingTexture.width - 1,
		Math.floor(((event.clientX - rect.left) / rect.width) * pickingTexture.width)
	));
	const y = Math.max(0, Math.min(
		pickingTexture.height - 1,
		Math.floor(((event.clientY - rect.top) / rect.height) * pickingTexture.height)
	));

	const pixelBuffer = new Uint8Array(4);
	renderer.readRenderTargetPixels(pickingTexture, x, pickingTexture.height - y - 1, 1, 1, pixelBuffer);

	const id = ((pixelBuffer[0] << 16) | (pixelBuffer[1] << 8) | pixelBuffer[2]) - 1;

	renderer.setRenderTarget(null);
	render();
	return id;
}
