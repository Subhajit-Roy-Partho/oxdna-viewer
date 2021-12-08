/**
 * Extends Nuculeotide with RNA-specific properties such as base position relative to backbone, and A-form helix creation
 */
class RNANucleotide extends Nucleotide {
    constructor(id, strand) {
        super(id, strand);
        this.bbnsDist = 0.8246211;
    }
    ;
    calcBBPos(p, a1, a2, a3) {
        return new THREE.Vector3(p.x - (0.4 * a1.x + 0.2 * a3.x), p.y - (0.4 * a1.y + 0.2 * a3.y), p.z - (0.4 * a1.z + 0.2 * a3.z));
    }
    ;
    getA2() {
        const a1 = this.getA1();
        const a3 = this.getA3();
        const a2 = a1.clone().cross(a3);
        return a2;
    }
    getA3() {
        const cm = this.getPos();
        const bb = this.getInstanceParameter3("bbOffsets");
        const a1 = this.getA1();
        const a3 = bb.clone().sub(cm).add(a1.clone().multiplyScalar(0.4)).divideScalar(-0.2);
        return a3;
    }
    ;
    // Uses the method from generate_RNA.py found in the oxDNA UTILS directory
    /**
     * Extend the current strand with addtional RNA bases in an ideal A-form helix
     * @param len Number of bases to create
     * @param direction Either "n3" or "n5" corresponding to the direction to create
     * @returns Array[] of [position, A1, A3]
     */
    extendStrand(len, direction, double) {
        //let angleLut = new THREE.Lut( 'rainbow', 180 );
        //angleLut.setMax(180);
        //angleLut.setMin(0);
        // Model constants
        const inclination = 15.5 * Math.PI / 180;
        const bp_backbone_distance = 2;
        const diameter = 2.35;
        const base_base_distance = 0.3287;
        const rot = 32.7 * Math.PI / 180;
        const cord = Math.cos(inclination) * bp_backbone_distance;
        const center_to_cord = Math.sqrt(Math.pow(diameter / 2, 2) - Math.pow(cord / 2, 2));
        // Current nucleotide information
        const oldA1 = this.getA1();
        const oldA2 = this.getA2();
        const oldA3 = this.getA3();
        // The helix axis is 15.5 degrees off from the a3 vector as rotated around a2
        const a3todir = new THREE.Quaternion();
        let dir = oldA3.clone();
        if (direction == "n5") {
            dir.multiplyScalar(-1);
        }
        a3todir.setFromAxisAngle(oldA2, -inclination);
        dir.applyQuaternion(a3todir);
        dir.normalize();
        //when extending from the n5 side, do I need to set the target position to r2 instead of r1?
        // RNA does not form a helix with bases pointed at a central axis like DNA does
        // instead, you have a chord between two points on a circle which defines the cm positions and the a1 vectors
        // This is the chord if the helix axis is the Z-axis
        const x1 = center_to_cord;
        const y1 = cord / 2;
        const z1 = -(bp_backbone_distance / 2) * Math.sin(inclination);
        const x2 = center_to_cord;
        const y2 = -cord / 2;
        const z2 = (bp_backbone_distance / 2) * Math.sin(inclination);
        let r1 = new THREE.Vector3(x1, y1, z1);
        let r2 = new THREE.Vector3(x2, y2, z2);
        // The angle between r1_to_r2 is 15.5 degrees off from the y axis.
        //let r1_to_r2 = r2.clone().sub(r1);
        //r1_to_r2.normalize();
        //console.log(r1_to_r2.angleTo(new THREE.Vector3(0,1,0)) * 180/Math.PI);
        // there are two assumptions made by the previously defined r1 and r2:
        // 1. the helix axis is the z-axis
        // 2. a1 of the initial nucleotide is  (0, -0.9636304532086232, 0.2672383760782569).
        // so first, we need to set the axis to the correct one
        let rotAxis1 = new THREE.Vector3(0, 0, 1).cross(dir);
        rotAxis1.normalize();
        let rotAngle1 = new THREE.Vector3(0, 0, 1).angleTo(dir);
        let rotMat1 = new THREE.Quaternion();
        rotMat1.setFromAxisAngle(rotAxis1, rotAngle1);
        r1.applyQuaternion(rotMat1);
        r2.applyQuaternion(rotMat1);
        // r1_to_r2 and A1 are in the same plane relative to dir
        let r1_to_r2 = r2.clone().sub(r1);
        r1_to_r2.normalize();
        r1_to_r2 = r2.clone().sub(r1);
        r1_to_r2.normalize();
        console.log("Are r1_to_r2 and the old a1 in the same plane? " + String(r1_to_r2.dot(dir) - oldA1.dot(dir)) + " : " + 0);
        // then set a1 to the correct orientation
        r1_to_r2 = r2.clone().sub(r1);
        r1_to_r2.normalize();
        //let rotAxis2 = dir.clone();
        let rotAxis2 = r1_to_r2.clone().cross(oldA1);
        rotAxis2.normalize();
        //let rotAngle2 = r1_to_r2.clone().projectOnPlane(dir).angleTo(oldA1.projectOnPlane(dir));
        let rotAngle2 = r1_to_r2.clone().angleTo(oldA1);
        let rotMat2 = new THREE.Quaternion();
        rotMat2.setFromAxisAngle(rotAxis2, rotAngle2);
        r1.applyQuaternion(rotMat2);
        r2.applyQuaternion(rotMat2);
        // This correctly set r1_to_r2 to be 90-15.5 deg off from the helix axis
        r1_to_r2 = r2.clone().sub(r1);
        r1_to_r2.normalize();
        console.log("calculated r1_to_r2 to helix axis " + r1_to_r2.angleTo(dir) * 180 / Math.PI + " : " + (90 - 15.5));
        // This is always correctly 90-15.5 deg off from the helix axis
        console.log("old a1 to helix axis " + oldA1.angleTo(dir) * 180 / Math.PI + " : " + (90 - 15.5));
        // The angle between r1_to_r2 and A1 should be 0 but it's not
        r1_to_r2 = r2.clone().sub(r1);
        r1_to_r2.normalize();
        console.log("angle between r1_to_r2 and old a1 " + String(r1_to_r2.angleTo(oldA1) * 180 / Math.PI) + " : " + 0);
        // center point of the helix axis
        // below, pos = r1 + start_pos + A1*0.4
        const start_pos = this.getPos().sub(r1).sub(oldA1.clone().multiplyScalar(0.4));
        //let marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), new THREE.MeshBasicMaterial({color: angleLut.getColor(r1_to_r2.angleTo(oldA1) * 180/Math.PI)}));
        //marker.position.copy(start_pos);
        //scene.add(marker);
        // create per-step rotation matrix
        let R = new THREE.Quaternion();
        R.setFromAxisAngle(dir, rot);
        // initialize properties of new nucleotide
        let a1;
        let a1proj = new THREE.Vector3;
        let a3;
        let out;
        let RNA_fudge;
        if (double) {
            out = new Array(len * 2);
        }
        else {
            out = new Array(len);
        }
        // generate nucleotide positions and orientations
        for (let i = 0; i < len; i++) {
            //calculate rotation around central axis and step along axis
            r1.applyQuaternion(R).add(dir.clone().multiplyScalar(base_base_distance));
            r2.applyQuaternion(R).add(dir.clone().multiplyScalar(base_base_distance));
            //console.log(r1.clone().projectOnPlane(dir).angleTo(r2.clone().projectOnPlane(dir))*180/Math.PI);
            // calculate a1 orientation
            r1_to_r2 = r2.clone().sub(r1);
            a1 = r1_to_r2.clone().normalize();
            // calculate a3 orientation
            a1proj = a1.clone().projectOnPlane(dir);
            a1proj.normalize();
            a3 = dir.clone().multiplyScalar(-Math.cos(inclination)).add(a1proj.clone().multiplyScalar(Math.sin(inclination)));
            a3.normalize();
            a3.multiplyScalar(-1);
            //the angle between a1 and a3 is correct
            //console.log(a1.angleTo(a3)*180/Math.PI);
            //the angle between a3 and dir is correct.
            //console.log(dir.angleTo(a3)*180/Math.PI);
            // the COM is 0.4(6)? off from r1
            // also need to offset to account for the helix axis not being (0,0,0)
            RNA_fudge = a1.clone().multiplyScalar(0.4);
            let p = r1.clone().add(RNA_fudge).add(start_pos);
            out[i] = [p, a1.clone(), a3.clone()];
            if (double) {
                a1 = r1_to_r2.clone().normalize().multiplyScalar(-1);
                a1proj = a1.clone().projectOnPlane(dir);
                a1proj.normalize();
                a3 = dir.clone().multiplyScalar(Math.cos(inclination)).add(a1proj.clone().multiplyScalar(Math.sin(inclination)));
                a3.normalize();
                a3.multiplyScalar(-1);
                RNA_fudge = a1.clone().multiplyScalar(0.4);
                let p = r2.clone().add(RNA_fudge).add(start_pos);
                out[len * 2 - (i + 1)] = [p, a1.clone(), a3.clone()]; // yes, topology is backwards.  See comment in addDuplexBySeq() 
            }
        }
        console.log(out);
        console.log(' ');
        return out;
    }
    isRNA() {
        return true;
    }
    weakPyrimindine() {
        return 'U';
    }
    getComplementaryType() {
        var map = { A: 'U', G: 'C', C: 'G', U: 'A' };
        return map[this.type];
    }
    toJSON() {
        // Get superclass attributes
        let json = super.toJSON();
        json['class'] = 'RNA';
        return json;
    }
}
;
