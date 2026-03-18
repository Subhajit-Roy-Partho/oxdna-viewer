import * as THREE_NS from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Lut, ColorMapKeywords } from 'three/examples/jsm/math/Lut.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

const THREE = { ...THREE_NS };

const bufferGeometryAliases = [
	'Box',
	'Circle',
	'Cone',
	'Cylinder',
	'Dodecahedron',
	'Extrude',
	'Icosahedron',
	'Lathe',
	'Octahedron',
	'Plane',
	'Polyhedron',
	'Ring',
	'Sphere',
	'Shape',
	'Tetrahedron',
	'Text',
	'Torus',
	'TorusKnot',
	'Tube',
];

for ( const name of bufferGeometryAliases ) {

	const modernName = `${name}Geometry`;
	const legacyName = `${name}BufferGeometry`;

	if ( THREE[ modernName ] && ! THREE[ legacyName ] ) {

		THREE[ legacyName ] = THREE[ modernName ];

	}

}

THREE.Math = THREE.MathUtils;
THREE.TrackballControls = TrackballControls;
THREE.TransformControls = TransformControls;
THREE.ConvexGeometry = ConvexGeometry;
THREE.Lut = Lut;
THREE.ColorMapKeywords = ColorMapKeywords;
THREE.GLTFExporter = GLTFExporter;
THREE.STLExporter = STLExporter;

if ( ! THREE.BufferGeometry.prototype.addAttribute ) {

	THREE.BufferGeometry.prototype.addAttribute = function addAttribute( name, attribute ) {

		return this.setAttribute( name, attribute );

	};

}

if ( ! THREE.BufferGeometry.prototype.applyMatrix ) {

	THREE.BufferGeometry.prototype.applyMatrix = function applyMatrix( matrix ) {

		return this.applyMatrix4( matrix );

	};

}

if ( ! THREE.Object3D.prototype.applyMatrix ) {

	THREE.Object3D.prototype.applyMatrix = function applyMatrix( matrix ) {

		return this.applyMatrix4( matrix );

	};

}

if ( ! THREE.Matrix4.prototype.getInverse ) {

	THREE.Matrix4.prototype.getInverse = function getInverse( matrix ) {

		return this.copy( matrix ).invert();

	};

}

if ( ! THREE.Quaternion.prototype.inverse ) {

	THREE.Quaternion.prototype.inverse = function inverse() {

		return this.invert();

	};

}

if ( ! THREE.Frustum.prototype.setFromMatrix ) {

	THREE.Frustum.prototype.setFromMatrix = function setFromMatrix( matrix ) {

		return this.setFromProjectionMatrix( matrix );

	};

}

if ( ! Object.getOwnPropertyDescriptor( THREE.InstancedBufferGeometry.prototype, 'maxInstancedCount' ) ) {

	Object.defineProperty( THREE.InstancedBufferGeometry.prototype, 'maxInstancedCount', {
		get() {

			return this.instanceCount;

		},
		set( value ) {

			this.instanceCount = value;

		},
	});

}

if ( ! TrackballControls.prototype.setToAxis ) {

	TrackballControls.prototype.setToAxis = function setToAxis( axis, steps = 10 ) {

		if ( this._target0 ) {

			this.target.copy( this._target0 );

		}

		const distance = this.object.position.length();
		const targetPosition = axis.clone().setLength( distance );

		if ( steps > 1 ) {

			this.object.position.lerp( targetPosition, 1 / steps );
			this.object.position.setLength( distance );

		} else {

			this.object.position.lerp( targetPosition, 0.999 );

		}

		this.object.lookAt( this.target );
		this.dispatchEvent( { type: 'change' } );

		if ( steps > 1 ) {

			requestAnimationFrame( () => this.setToAxis( axis, steps - 1 ) );

		}

	};

}

if ( ! Object.getOwnPropertyDescriptor( TrackballControls.prototype, 'target0' ) ) {

	Object.defineProperty( TrackballControls.prototype, 'target0', {
		get() {

			return this._target0;

		}
	} );

	Object.defineProperty( TrackballControls.prototype, 'position0', {
		get() {

			return this._position0;

		}
	} );

	Object.defineProperty( TrackballControls.prototype, 'up0', {
		get() {

			return this._up0;

		}
	} );

}

if ( ! TrackballControls.prototype.stepAroundAxis ) {

	TrackballControls.prototype.stepAroundAxis = function stepAroundAxis( axis, stepAngle ) {

		const quaternion = new THREE.Quaternion();
		const orbitAxis = this.object.localToWorld( axis.clone() ).sub( this.object.position ).normalize();
		const eye = this.object.position.clone().sub( this.target );

		quaternion.setFromAxisAngle( orbitAxis, stepAngle );

		eye.applyQuaternion( quaternion );
		this.object.up.applyQuaternion( quaternion );
		this.object.position.copy( this.target ).add( eye );
		this.object.lookAt( this.target );
		this.dispatchEvent( { type: 'change' } );

	};

}

THREE.SceneUtils = {
	createMultiMaterialObject( geometry, materials ) {

		const group = new THREE.Group();
		for ( const material of materials ) {

			group.add( new THREE.Mesh( geometry, material ) );

		}
		return group;

	},
	detach( child, parent, scene ) {

		child.applyMatrix4( parent.matrixWorld );
		parent.remove( child );
		scene.add( child );

	},
	attach( child, scene, parent ) {

		child.applyMatrix4( new THREE.Matrix4().copy( parent.matrixWorld ).invert() );
		scene.remove( child );
		parent.add( child );

	},
};

globalThis.THREE = THREE;
globalThis.VRButton = VRButton;
globalThis.GLTFExporter = GLTFExporter;
globalThis.STLExporter = STLExporter;
