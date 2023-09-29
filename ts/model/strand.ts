/**
 * Defines a collection of linearly connected BasicElements.  
 * Is extended by NuclicAcidStrand and Peptide.
 * @param strandID - The strand's id within the system
 * @param system - The strand's parent system
 */

abstract class Strand {

    id: number; //system location
    system: System;
    pos: THREE.Vector3;
    label: string;
    end3: BasicElement;
    end5: BasicElement;
    kwdata: Object;


    constructor(id: number, system: System) {
        this.id = id;
        this.system = system;
        this.kwdata = {}
    };

    setFrom(e: BasicElement) {
        if (e) {
            this.end3 = this.end5 = e;
            this.updateEnds();
            this.forEach(e=>{
                e.strand = this;
            })
        } else {
            throw new Error("Cannot set empty strand end");
        }
    }

    isCircular() {
        return this.end3.n3 != null && this.end3.n3 == this.end5;
    }

    createBasicElement(id?: number): BasicElement {
        throw "Cannot create a basic element, need to be a nucleotide, amino acid, etc.";
    }

    getSequence() {
        return this.map(e=>e.type).join('');
    }

    getLength() {
        let e = this.end3;
        let i = 0;
        while(e) {
            e = e.n5;
            i++;
            if(e === this.end3) break;
        }
        return i;
    }

    getKwdataString(dni: string[]) { //dni stands for "do not include"
        let outStr: string[] = []
        for (const [key, value] of Object.entries(this.kwdata)) {
            if (!dni.includes(key)) { outStr.push(key+"="+value) }
        }
        return (outStr.join (" "))
    }  

    updateEnds() {
        let start = this.end3;
        while(this.end3.n3 && this.end3.n3 != this.end5) {
            this.end3 = this.end3.n3;
            // Avoid infinite loop on circular strand
            if (this.end3 == start) {
                this.end5 = this.end3.n3;
                return;
            }
        };
        start = this.end5;
        while(this.end5.n5  && this.end3.n5 != this.end3) {
            this.end5 = this.end5.n5;
            // Avoid infinite loop on circular strand
            if (this.end5 == start) {
                this.end3 = this.end5.n5;
                return;
            }
        };
    }

    /**
     * Return a list of all monomers in strand, in 5' to 3' order
     * @param reverse If set to true, return list in 3' to 5' order instead
     */
    getMonomers(reverse?:boolean): BasicElement[] {
        return this.map(e=>e, reverse);
    }

    /**
     * Performs the specified action for each element of the strand.
     * @param callbackfn A function that accepts up to two arguments
     * @param reverse Iterate in 3' to 5' direction, instead of the default 5' to 3'
     * @param condition If provided, only continue looping while condition is true
     */
    forEach(callbackfn: (value: BasicElement, index: number)=>void, reverse?:boolean, condition?: (value: BasicElement, index: number)=>boolean) {
        const start = reverse ? this.end3 : this.end5;
        let e = start;
        let i = 0;
        while(e && (!condition || condition(e,i))) {
            callbackfn(e, i);
            e = reverse ? e.n5 : e.n3;
            i++;
            if(e === start) break;
        }
    }

    /**
     * Calls a defined callback function on each monomer of the strand, and returns an array that contains the results
     * @param callbackfn A function that accepts up to two arguments
     * @param reverse Iterate in 3' to 5' direction, instead of the default 5' to 3'
     */
    map(callbackfn: (value: BasicElement, index: number)=>void, reverse?:boolean) {
        let list = [];
        this.forEach((e,i)=>{list.push(callbackfn(e, i))}, reverse);
        return list;
    }

    /**
     * Returns the monomers of the strand that meet the condition specified in a callback function.
     * @param callbackfn — A function that accepts up to two arguments, returning a boolean
     * @param reverse Retur filtered list in 3' to 5' direction, instead of the default 5' to 3'
     */
    filter(callbackfn: (value: BasicElement, index: number)=>boolean, reverse?:boolean) {
        let list = [];
        this.forEach((e,i)=>{
            if(callbackfn(e,i)){
                list.push(e);
            }
        }, reverse);
        return list;
    }

    //reverse is set to true so things select in standard oxDNA d3'-5' order
    toggleMonomers() {
        this.forEach(e=>e.toggle(), true);
    }

    select() {
        this.forEach(e=>e.select(), true);
    }

    deselect() {
        this.forEach(e=>e.deselect(), true);
    }

    isEmpty(): Boolean {
        //console.assert(this.end3 ? true : !this.end5, "Stand incorrectly empty");
        return !this.end3 && !this.end5;
    }

    getPos() {
        let com = new THREE.Vector3();
        let length = 0;
        this.forEach(e=>{
            com.add(e.getPos());
            length ++;
        })
        return com.divideScalar(length);
    };

    abstract translateStrand(amount: THREE.Vector3): void;

    isPeptide(): boolean{
        return false;
    }

    isNucleicAcid(): boolean {
        return false;
    }

    isGS(): boolean {
        return false;
    }

    toJSON() {
        // Specify required attributes
        let json = {
            id: this.id,
            monomers: this.getMonomers(),
            end3: this.end3.id,
            end5: this.end5.id
        };
        // Specify optional attributes
        if (this.label) json['label'] = this.label;

        return json;
    };
};

class NucleicAcidStrand extends Strand {
    constructor(id: number, system: System) {
        super(id, system);
    };

    createBasicElement(id?: number) {
        if (this.kwdata['type'] == 'RNA')
            return new RNANucleotide(id, this);
        else
            return new DNANucleotide(id, this);
    };

    createBasicElementTyped(type: string, id?: number) {
        if (type.toLowerCase() == 'rna')
            return new RNANucleotide(id, this);
        else if (type.toLowerCase() == 'dna')
            return new DNANucleotide(id, this);
        else{
            notify(type+" is not a recognized nucleic acid type, oxView only supports 'dna' or 'rna' at the moment.")
            return
        }
    };

    /**
     * Translate the strand by a given amount
     * @param amount Vector3 with the amount to translate the strand
     */
    translateStrand(amount: THREE.Vector3) {
        const s = this.system;
        const monomers = this.getMonomers(true);
        monomers.forEach(e => e.translatePosition(amount));
        
        s.callUpdates(['instanceOffset'])
        if (tmpSystems.length > 0) {
            tmpSystems.forEach((s) => {
                s.callUpdates(['instanceOffset'])
            })
        }
    }

    /**
     * Find all domains in the strand matching the provided sequence.
     * @param sequence
     * @returns List of list of nucleotides (empty if no match)
     */
    search(sequence: string) {
        let matching: Nucleotide[] = [];
        let matchings: Nucleotide[][] = [];
        this.forEach((e: Nucleotide)=> {
            if (matching.length === sequence.length) {
                // One full domain found, start looking for more
                matchings.push(matching);
                matching = [];
            }
            if (e.isType(sequence[matching.length])) {
                // Add elements while they match the sequence
                matching.push(e);
            } else {
                // Not a match
                matching = [];
                // Maybe it matches the first element?
                if (e.isType(sequence[matching.length])) {
                    matching.push(e);
                }
            }
        });
        // Don't forget that the last one might be a match
        if (matching.length === sequence.length) {
            matchings.push(matching);
        }
        //console.log(matchings.map(m=>m.map(e=>e.type).join('')).join('|'));
        return matchings;
    }

    isNucleicAcid(): boolean {
        return true;
    }


    toJSON() {
        // Get superclass attributes
        let json = super.toJSON();
        json['class'] = 'NucleicAcidStrand';
        return json;
    };
}
class Peptide extends Strand {
    constructor(id: number, system: System) {
        super(id, system);
    };

    createBasicElement(id?: number) {
        return new AminoAcid(id, this);
    };

    translateStrand(amount: THREE.Vector3) {
        const s = this.system;
        const monomers = this.getMonomers();
        for (
            let i = monomers[0].sid * 3;
            i <= monomers[monomers.length-1].sid * 3;
            i+=3)
        {

            s.nsOffsets[i] += amount.x;
            s.nsOffsets[i + 1] += amount.y;
            s.nsOffsets[i + 2] += amount.z;

            s.bbOffsets[i] += amount.x;
            s.bbOffsets[i + 1] += amount.y;
            s.bbOffsets[i + 2] += amount.z;

            s.bbconOffsets[i] += amount.x;
            s.bbconOffsets[i + 1] += amount.y;
            s.bbconOffsets[i + 2] += amount.z;

            s.cmOffsets[i] += amount.x;
            s.cmOffsets[i + 1] += amount.y;
            s.cmOffsets[i + 2] += amount.z;
        } 
        s.callUpdates(['instanceOffset'])
        if (tmpSystems.length > 0) {
            tmpSystems.forEach((s) => {
                s.callUpdates(['instanceOffset'])
            })
        }
    };

    isPeptide(): boolean{
        return true;
    }

    toJSON() {
        // Get superclass attributes
        let json = super.toJSON();
        json['class'] = 'Peptide';
        return json;
    };

    //the default for DNA/RNA reflects that DNA/RNA are written backwards in oxDNA, but proteins are written the normal way.
    getMonomers(reverse?:boolean): BasicElement[] {
        return super.getMonomers(!reverse)
    }

    forEach(callbackfn: (value: BasicElement, index: number)=>void, reverse?:boolean, condition?: (value: BasicElement, index: number)=>boolean) {
        super.forEach(callbackfn, !reverse, condition);
    }

    map(callbackfn: (value: BasicElement, index: number)=>void, reverse?:boolean) {
        return super.map(callbackfn, !reverse);
    }

    filter(callbackfn: (value: BasicElement, index: number)=>boolean, reverse?:boolean) {
        return super.filter(callbackfn, !reverse)
    }

    toggleMonomers() {
        this.forEach(e=>e.toggle());
    }

    select() {
        this.forEach(e=>e.select());
    }

    deselect() {
        this.forEach(e=>e.deselect());
    }

}

// Meant to hold multi-sized generic spheres representing arbitrary particle types
class Generic extends Strand {
    constructor(id: number, system: System) {
        super(id, system);
    };

    createBasicElement(id?: number) {
        return new GenericSphere(id, this);
    };


    translateStrand(amount: THREE.Vector3) {
        const s = this.system;
        const monomers = this.getMonomers();
        for (
            let i = monomers[0].sid * 3;
            i <= monomers[monomers.length-1].sid * 3;
            i+=3)
        {

            s.nsOffsets[i] += amount.x;
            s.nsOffsets[i + 1] += amount.y;
            s.nsOffsets[i + 2] += amount.z;

            s.bbOffsets[i] += amount.x;
            s.bbOffsets[i + 1] += amount.y;
            s.bbOffsets[i + 2] += amount.z;

            s.bbconOffsets[i] += amount.x;
            s.bbconOffsets[i + 1] += amount.y;
            s.bbconOffsets[i + 2] += amount.z;

            s.cmOffsets[i] += amount.x;
            s.cmOffsets[i + 1] += amount.y;
            s.cmOffsets[i + 2] += amount.z;
        }
        s.callUpdates(['instanceOffset'])
        if (tmpSystems.length > 0) {
            tmpSystems.forEach((s) => {
                s.callUpdates(['instanceOffset'])
            })
        }
    };

    isGS(): boolean{
        return true;
    }

    toJSON() {
        // Get superclass attributes
        let json = super.toJSON();
        json['class'] = 'GS';
        return json;
    }

    //the default for DNA/RNA reflects that DNA/RNA are written backwards in oxDNA, but proteins are written the normal way.
    getMonomers(reverse?:boolean): BasicElement[] {
        return super.getMonomers(!reverse)
    }

    forEach(callbackfn: (value: BasicElement, index: number)=>void, reverse?:boolean, condition?: (value: BasicElement, index: number)=>boolean) {
        super.forEach(callbackfn, !reverse, condition);
    }

    map(callbackfn: (value: BasicElement, index: number)=>void, reverse?:boolean) {
        return super.map(callbackfn, !reverse);
    }

    filter(callbackfn: (value: BasicElement, index: number)=>boolean, reverse?:boolean) {
        return super.filter(callbackfn, !reverse)
    }

    toggleMonomers() {
        this.forEach(e=>e.toggle());
    }

    select() {
        this.forEach(e=>e.select());
    }

    deselect() {
        this.forEach(e=>e.deselect());
    }

}