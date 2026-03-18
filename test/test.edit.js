// Have a look at https://mochajs.org/

// Setup
console.log("Test Loaded");
let assert = chai.assert;
let oxview=document.getElementById("oxview").contentWindow;
let seq = "ACTGCCTAAGCCTAAG";
var compl = {A:'T',G:'C',C:'G', T:'A'}
let complseq = Array.from(seq).map(c=>compl[c]).reverse().join('');

function assertVectorClose(actual, expected, epsilon = 1e-6) {
  assert.isAtMost(actual.distanceTo(expected), epsilon, `${actual.toArray()} is not close to ${expected.toArray()}`);
}

describe('Editing', function () {
  describe('Create strand', function () {
    before(function () {
      oxview.edit.createStrand(seq);
    });
    it('should create one strand', function () {
      let systems = oxview.getSystems();
      assert(systems.length == 1);
      assert(systems[0].strands.length == 1);
    });
    it('should have the correct length', function () {
      assert(oxview.getSystems()[0].strands[0].getLength() == seq.length)
      assert(oxview.getElements().size == seq.length);
    });
    it('should have the correct sequence', function () {
      let strand = oxview.getElements().get(0).strand;
      assert(strand.getSequence() == seq);
    });
    it('should have correct endpoints', function () {
      let strand = oxview.getElements().get(0).strand;
      assert(strand.end3);
      assert(!strand.end3.n3);
      assert(!strand.end5.n5);
    });
    after(function () {
      let elems = Array.from(oxview.getElements().values());
      oxview.edit.deleteElements(elems);
    });
  });
  describe('Create duplex', function () {
    before(function () {
      oxview.edit.createStrand(seq, true);
    });
    it('should create two strands', function () {
      let systems = oxview.getSystems();
      assert(systems.length == 1);
      assert(systems[0].strands.length == 2, `${systems[0].strands.length} strands instead of 2`);
    });
    it('should have the correct lengths', function () {
      assert(oxview.getSystems()[0].strands[0].getLength() == seq.length)
      assert(oxview.getSystems()[0].strands[1].getLength() == seq.length)
      assert(oxview.getElements().size == 2*seq.length);
    });
    it('should have the correct sequence', function () {
      let strand1 = oxview.getSystems()[0].strands[0];
      let strand2 = oxview.getSystems()[0].strands[1];
      assert(strand1.getSequence() == seq);
      assert(strand2.getSequence() == complseq);
    });
    it('should have correct endpoints', function () {
      let strand1 = oxview.getSystems()[0].strands[0];
      let strand2 = oxview.getSystems()[0].strands[1];
      [strand1, strand2].forEach(strand=>{
        assert(strand.end3);
        assert(strand.end5);
        assert(!strand.end3.n3);
        assert(!strand.end5.n5);
      });
    });
    after(function () {
      let elems = Array.from(oxview.getElements().values());
      oxview.edit.deleteElements(elems);
    });
  });
  describe('Circular strands', function () {
    before(function () {
      oxview.edit.createStrand(seq);
    });
    it('should not be circular from the start', function () {
      let strand = oxview.getSystems()[0].strands[0];
      assert(!strand.isCircular());
    });
    it('should be circular after ligating the ends', function () {
      let strand = oxview.getSystems()[0].strands[0];
      oxview.edit.ligate(strand.end3, strand.end5);
      assert(strand.isCircular());
    });
    it('should not be circular after nicking', function () {
      let strand = oxview.getSystems()[0].strands[0];
      oxview.edit.nick(strand.end5);
      assert(!strand.isCircular());
    });
    it('should have correct endpoints', function () {
      let strand = oxview.getSystems()[0].strands[0];
      assert(strand.end3);
      assert(strand.end5);
      assert(!strand.end3.n3);
      assert(!strand.end5.n5);
    });

    after(function () {
      let elems = Array.from(oxview.getElements().values());
      oxview.edit.deleteElements(elems);
    });
  });
  describe('Ligation', function () {
    before(function () {
      oxview.edit.createStrand(seq, true);
    });
    it('should be two strands from the start', function () {
      assert(oxview.getSystems()[0].strands.length == 2);
    });
    it('should be one strand after ligation', function () {
      let strand1 = oxview.getSystems()[0].strands[0];
      let strand2 = oxview.getSystems()[0].strands[1];
      oxview.edit.ligate(strand1.end3, strand2.end5);
      assert(oxview.getSystems()[0].strands.length == 1);
    });
    it('should have the combinded sequence of the two strands', function () {
      let strand = oxview.getSystems()[0].strands[0];
      assert(strand.getSequence() == seq+complseq);
    });
    it('should have correct endpoints', function () {
      let strand = oxview.getSystems()[0].strands[0];
      assert(strand.end3);
      assert(strand.end5);
      assert(!strand.end3.n3);
      assert(!strand.end5.n5);
    });
    after(function () {
      let elems = Array.from(oxview.getElements().values());
      oxview.edit.deleteElements(elems);
    });
  });
  describe('Nicking', function () {
    before(function () {
      oxview.edit.createStrand(seq);
    });
    it('should be one strand from the start', function () {
      assert(oxview.getSystems()[0].strands.length == 1);
    });
    it('should be two strands after nicking', function () {
      let strand = oxview.getSystems()[0].strands[0];
      let monomers = strand.getMonomers();
      let middle = monomers[Math.round(monomers.length/2) - 1];
      oxview.edit.nick(middle);
      assert(oxview.getSystems()[0].strands.length == 2);
    });
    it('should have each half of the sequence', function () {
      let strand1 = oxview.getSystems()[0].strands[1];
      let strand2 = oxview.getSystems()[0].strands[0];
      let i = Math.round(seq.length/2);
      assert(strand1.getSequence() == seq.substr(i), `${strand1.getSequence()} is not ${seq.substr(i)}`);
      assert(strand2.getSequence() == seq.substr(0,i), `${strand1.getSequence()} is not ${seq.substr(0,i)}`);
    });
    it('should have correct endpoints', function () {
      let strand1 = oxview.getSystems()[0].strands[0];
      let strand2 = oxview.getSystems()[0].strands[1];
      [strand1, strand2].forEach(strand=>{
        assert(strand.end3);
        assert(strand.end5);
        assert(!strand.end3.n3);
        assert(!strand.end5.n5);
      });
    });
    after(function () {
      let elems = Array.from(oxview.getElements().values());
      oxview.edit.deleteElements(elems);
    });
  });
});

describe('Runtime compatibility', function () {
  it('should expose modern THREE globals and exporters', function () {
    assert(oxview.THREE, 'THREE global is missing');
    assert.equal(oxview.THREE.REVISION, '183');
    assert.isFunction(oxview.THREE.TrackballControls);
    assert.isFunction(oxview.THREE.TransformControls);
    assert.isFunction(oxview.THREE.ConvexGeometry);
    assert.isFunction(oxview.THREE.Lut);
    assert.isFunction(oxview.GLTFExporter);
    assert.isFunction(oxview.STLExporter);
  });

  it('should preserve plugin eval access to THREE', function () {
    oxview.eval(`
      window.__compatPluginColor = undefined;
      addPlugin('__compat_plugin__', 'window.__compatPluginColor = new THREE.Color(0xff0000).getHex();');
    `);
    assert.equal(oxview.__compatPluginColor, 0xff0000);
  });

  it('should preserve custom trackball helpers and transform control helpers', function () {
    assert.isTrue(oxview.eval(`
      typeof controls.setToAxis === 'function' &&
      typeof controls.stepAroundAxis === 'function' &&
      typeof transformControls.show === 'function' &&
      typeof transformControls.hide === 'function' &&
      typeof transformControls.isHovered === 'function'
    `));
  });

  it('should allow observable creation with THREE.Mesh-compatible objects', function () {
    const sizeBefore = oxview.eval('scene.children.length');
    oxview.eval(`
      window.__compatElems = edit.createStrand("AT");
      window.__compatCms = new api.observable.CMS(window.__compatElems, 0.5, 0xff0000);
      window.__compatTrack = new api.observable.Track(window.__compatCms);
    `);
    const sizeAfter = oxview.eval('scene.children.length');
    assert.isAbove(sizeAfter, sizeBefore);
    oxview.eval(`
      scene.remove(window.__compatTrack);
      scene.remove(window.__compatCms);
      edit.deleteElements(window.__compatElems);
      clearSelection();
    `);
  });

  it('should keep camera switching callable', function () {
    oxview.api.switchCamera();
    oxview.api.switchCamera();
    assert.isOk(true);
  });

  it('should point worker scripts at the compat bundle', async function () {
    const [pdbWorker, tacoWorker] = await Promise.all([
      oxview.fetch('dist/file_handling/pdb_worker.js').then(r => r.text()),
      oxview.fetch('dist/file_handling/tacoxdna_worker.js').then(r => r.text())
    ]);
    assert.include(pdbWorker, '../vendor/three-core-compat.js');
    assert.include(tacoWorker, '../vendor/three-core-compat.js');
  });
});

describe('Scene API', function () {
  before(function () {
    oxview.edit.createStrand(seq);
    oxview.eval('clearSelection()');
  });

  after(function () {
    oxview.eval('clearSelection()');
    let elems = Array.from(oxview.getElements().values());
    oxview.edit.deleteElements(elems);
  });

  it('should expose the documented and new scene helpers', function () {
    [
      'markStrand',
      'getSequence',
      'spOnly',
      'getElement',
      'getElementPosition',
      'getBasePosition',
      'getBackbonePosition',
      'getElementPositions',
      'getElementOrientation',
      'getElementInfo',
      'getSelectedBases',
      'getSelectedElementIDs',
      'getCenterOfMass',
      'getDistance'
    ].forEach(name => assert.isFunction(oxview.api[name], `${name} is missing`));
    ['getLastError', 'clearLastError', 'getErrorHistory', 'clearErrorHistory'].forEach(name => {
      assert.isFunction(oxview.api[name], `api.${name} is missing`);
      assert.isFunction(oxview.edit[name], `edit.${name} is missing`);
      assert.isFunction(oxview.api.observable[name], `api.observable.${name} is missing`);
    });
  });

  it('should return strand sequences and length groupings correctly', function () {
    const strand = oxview.getSystems()[0].strands[0];
    assert.equal(oxview.api.getSequence(strand), seq);
    const lengths = oxview.api.countStrandLength();
    assert.equal(lengths[seq.length].length, 1);
    assert.equal(lengths[seq.length][0], strand);
  });

  it('should mark an entire strand and report the selected ids', function () {
    const strand = oxview.getSystems()[0].strands[0];
    oxview.eval('clearSelection()');
    oxview.api.markStrand(strand, false);
    const selected = oxview.api.getSelectedBases();
    const selectedIds = oxview.api.getSelectedElementIDs();
    assert.equal(selected.length, seq.length);
    assert.equal(selectedIds.length, seq.length);
    assert.sameMembers(selectedIds, strand.getMonomers().map(e => e.id));
  });

  it('should report element positions consistently', function () {
    const elem = oxview.getElements().get(0);
    assertVectorClose(oxview.api.getElementPosition(elem, 'center'), elem.getPos());
    assertVectorClose(oxview.api.getBackbonePosition(elem), elem.getInstanceParameter3('bbOffsets'));
    assertVectorClose(oxview.api.getBasePosition(elem), elem.getInstanceParameter3('nsOffsets'));
    const positions = oxview.api.getElementPositions([elem], 'backbone');
    assert.equal(positions.length, 1);
    assertVectorClose(positions[0], elem.getInstanceParameter3('bbOffsets'));
  });

  it('should report orientation, info, center of mass, and distance helpers', function () {
    const strand = oxview.getSystems()[0].strands[0];
    const [first, second] = strand.getMonomers();
    const orientation = oxview.api.getElementOrientation(first);
    assert.closeTo(orientation.a1.length(), 1, 1e-6);
    assert.closeTo(orientation.a3.length(), 1, 1e-6);

    const info = oxview.api.getElementInfo(first);
    assert.equal(info.id, first.id);
    assert.equal(info.systemId, first.getSystem().id);
    assert.equal(info.strandId, strand.id);
    assert.equal(info.positions.center.length, 3);
    assert.equal(info.orientation.a1.length, 3);

    const manualCom = first.getPos().clone().add(second.getPos()).divideScalar(2);
    const apiCom = oxview.api.getCenterOfMass([first, second]);
    assertVectorClose(apiCom, manualCom);

    const manualDist = first.getPos().distanceTo(second.getPos());
    assert.closeTo(oxview.api.getDistance(first, second), manualDist, 1e-6);
    assert.equal(oxview.api.getElement(first.id), first);
  });

  it('should support sugar-phosphate-only mode and restoration', function () {
    const elem = oxview.getElements().get(0);
    oxview.api.spOnly();
    assertVectorClose(elem.getInstanceParameter3('scales'), new oxview.THREE.Vector3(0, 0, 0));
    assertVectorClose(elem.getInstanceParameter3('nsScales'), new oxview.THREE.Vector3(0, 0, 0));
    assertVectorClose(elem.getInstanceParameter3('conScales'), new oxview.THREE.Vector3(0, 0, 0));

    oxview.api.showEverything();
    assertVectorClose(elem.getInstanceParameter3('scales'), new oxview.THREE.Vector3(1, 1, 1));
  });

  it('should record API errors so they can be inspected later', function () {
    oxview.api.clearErrorHistory();
    let caught = false;
    try {
      oxview.api.getElementPosition(oxview.getElements().get(0), 'definitely-not-a-position');
    } catch (error) {
      caught = true;
    }

    assert.isTrue(caught, 'Expected API call to throw');
    const lastError = oxview.api.getLastError();
    assert.equal(lastError.namespace, 'api');
    assert.equal(lastError.method, 'getElementPosition');
    assert.include(lastError.message, 'Unknown position target');
    assert.isAtLeast(oxview.api.getErrorHistory().length, 1);
    assert.deepEqual(oxview.edit.getLastError(), lastError);
    oxview.api.clearErrorHistory();
  });
});
