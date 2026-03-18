import * as THREE_NS from 'three';

const THREE = {
	...THREE_NS,
	Math: THREE_NS.MathUtils,
};

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

globalThis.THREE = THREE;
