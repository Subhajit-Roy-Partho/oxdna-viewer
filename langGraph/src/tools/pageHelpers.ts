// @ts-nocheck

function installOxViewLangGraphHelpers() {
  const normalizeBaseTypes = (baseTypes) =>
    (baseTypes || []).map((value) => String(value).toUpperCase());

  const resolveElementKind = (element) => {
    if (element?.isNucleotide?.()) return "nucleotide";
    if (element?.isAminoAcid?.()) return "aminoAcid";
    if (element?.isGS?.()) return "genericSphere";
    return "unknown";
  };

  const getAttributeValue = (element, field) => {
    switch (field) {
      case "type":
        return element.type;
      case "label":
        return element.label ?? "";
      case "clusterId":
        return element.clusterId ?? null;
      case "strandId":
        return element.strand?.id ?? null;
      case "systemId":
        return element.getSystem?.().id ?? null;
      default:
        return null;
    }
  };

  const matchesPredicate = (element, predicate) => {
    if (!predicate) return true;
    const actual = getAttributeValue(element, predicate.field);
    const expected = predicate.value;
    switch (predicate.operator) {
      case "eq":
        return actual === expected;
      case "neq":
        return actual !== expected;
      case "contains":
        return String(actual ?? "")
          .toLowerCase()
          .includes(String(expected).toLowerCase());
      case "gt":
        return Number(actual) > Number(expected);
      case "lt":
        return Number(actual) < Number(expected);
      default:
        return false;
    }
  };

  const matchesFilter = (element, filter = {}) => {
    if (!element) return false;
    if (filter.ids && !filter.ids.includes(element.id)) return false;
    if (filter.parity) {
      const parity = element.id % 2 === 0 ? "even" : "odd";
      if (parity !== filter.parity) return false;
    }
    if (filter.strandIds && !filter.strandIds.includes(element.strand?.id)) return false;
    if (filter.selectedOnly && !selectedBases.has(element)) return false;
    if (filter.elementKinds && !filter.elementKinds.includes(resolveElementKind(element))) return false;
    if (filter.baseTypes) {
      const allowed = normalizeBaseTypes(filter.baseTypes);
      if (!allowed.includes(String(element.type).toUpperCase())) return false;
    }
    if (!matchesPredicate(element, filter.attributePredicate)) return false;
    return true;
  };

  const findElements = (filter = {}) => {
    const matches = Array.from(elements.values())
      .filter(Boolean)
      .filter((element) => matchesFilter(element, filter))
      .sort((a, b) => a.id - b.id);

    return filter.limit ? matches.slice(0, filter.limit) : matches;
  };

  const getColorVector = (color) => {
    const threeColor = new THREE.Color(color);
    return {
      color: threeColor,
      vector: [threeColor.r, threeColor.g, threeColor.b],
    };
  };

  const getSystemsToUpdate = (elementsToUpdate) => {
    const touched = new Set();
    elementsToUpdate.forEach((element) => {
      touched.add(element.dummySys ?? element.getSystem());
    });
    return Array.from(touched);
  };

  const getElementCenter = (elementsToMeasure) => {
    const center = new THREE.Vector3();
    if (!elementsToMeasure.length) {
      return center;
    }
    elementsToMeasure.forEach((element) => {
      center.add(element.getPos());
    });
    return center.divideScalar(elementsToMeasure.length);
  };

  const randomSequence = (length, nucleicAcidType) => {
    const alphabet = nucleicAcidType === "RNA"
      ? ["A", "U", "C", "G"]
      : ["A", "T", "C", "G"];
    return Array.from({ length }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  };

  const uniqueStrands = (elementsToCheck) =>
    Array.from(
      new Set(elementsToCheck.map((element) => element.strand).filter(Boolean)),
    );

  const getBundleBasis = (axis) => {
    let reference = camera?.up?.clone?.() ?? new THREE.Vector3(0, 1, 0);
    if (Math.abs(reference.clone().normalize().dot(axis)) > 0.95) {
      reference = new THREE.Vector3(1, 0, 0);
    }
    const first = reference
      .sub(axis.clone().multiplyScalar(reference.dot(axis)))
      .normalize();
    const second = axis.clone().cross(first).normalize();
    return [first, second];
  };

  const getHexLatticeCoordinates = (count) => {
    const coordinates = [[0, 0]];
    const directions = [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ];

    for (let radius = 1; coordinates.length < count; radius += 1) {
      let q = -radius;
      let r = radius;
      for (const [dq, dr] of directions) {
        for (let step = 0; step < radius && coordinates.length < count; step += 1) {
          coordinates.push([q, r]);
          q += dq;
          r += dr;
        }
      }
    }

    return coordinates;
  };

  const focusCameraOnPoint = (targetCenter, targetDistance = 40) => {
    const fallbackOffset = new THREE.Vector3(0, 0, 1);
    const currentTarget = controls?.target?.clone?.() ?? targetCenter.clone();
    const currentOffset = camera.position.clone().sub(currentTarget);
    const offsetDirection =
      currentOffset.lengthSq() > 1e-6
        ? currentOffset.normalize()
        : fallbackOffset;

    if (controls?.target?.copy) {
      controls.target.copy(targetCenter);
    } else if (controls) {
      controls.target = targetCenter.clone();
    }
    camera.position.copy(
      targetCenter.clone().add(offsetDirection.multiplyScalar(targetDistance)),
    );
    if (typeof camera?.lookAt === "function") {
      camera.lookAt(targetCenter);
    }
    if (typeof controls?.update === "function") {
      controls.update();
    }
    render();
  };

  globalThis.__oxviewLangGraphHelpers = {
    getSceneSummary(input = {}) {
      return {
        systemCount: systems.length,
        elementCount: elements.size,
        selectedIds: api.getSelectedElementIDs ? api.getSelectedElementIDs() : Array.from(selectedBases).map((e) => e.id),
        coloringMode: view?.coloringMode?.get?.() ?? null,
        transformMode: view?.transformMode?.get?.() ?? null,
        cameraType: camera?.type ?? null,
        apiErrors: api.getErrorHistory ? api.getErrorHistory() : [],
      };
    },

    findElements(input) {
      const ids = findElements(input.filter).map((element) => element.id);
      return { ids, count: ids.length, filter: input.filter };
    },

    getElementInfo(input) {
      const element = api.getElement(input.elementId);
      return element ? api.getElementInfo(element) : null;
    },

    getDistance(input) {
      const first = api.getElement(input.firstElementId);
      const second = api.getElement(input.secondElementId);
      if (!first || !second) {
        return {
          distance: NaN,
          firstElementId: input.firstElementId,
          secondElementId: input.secondElementId,
          target: input.target,
        };
      }
      return {
        distance: api.getDistance(first, second, input.target),
        firstElementId: input.firstElementId,
        secondElementId: input.secondElementId,
        target: input.target,
      };
    },

    getCenterOfMass(input) {
      const ids = findElements(input.filter).map((element) => element.id);
      const elementsToMeasure = api.getElements(ids);
      return {
        ids,
        target: input.target,
        center: api.getCenterOfMass(elementsToMeasure, input.target).toArray(),
      };
    },

    getApiErrors() {
      return {
        last: api.getLastError ? api.getLastError() : null,
        history: api.getErrorHistory ? api.getErrorHistory() : [],
      };
    },

    selectElements(input) {
      const ids = findElements(input.filter).map((element) => element.id);
      api.selectElements(api.getElements(ids), input.mode === "add");
      return {
        success: true,
        mutation: true,
        idsAffected: ids,
        selectedIds: api.getSelectedElementIDs ? api.getSelectedElementIDs() : ids,
      };
    },

    clearSelection() {
      clearSelection();
      return {
        success: true,
        mutation: true,
        idsAffected: [],
        selectedIds: [],
      };
    },

    colorElements(input) {
      const elementsToColor = findElements(input.filter);
      const ids = elementsToColor.map((element) => element.id);
      const { color, vector } = getColorVector(input.color);

      if (input.applyTo === "custom") {
        elementsToColor.forEach((element) => {
          element.color = color;
        });
        updateColoring("Custom");
      } else {
        const touchedSystems = getSystemsToUpdate(elementsToColor);
        elementsToColor.forEach((element) => {
          const system = element.dummySys ?? element.getSystem();
          const sid = element.sid;
          if (input.applyTo === "base") {
            system.fillVec("nsColors", 3, sid, vector);
          } else if (input.applyTo === "backbone") {
            system.fillVec("bbColors", 3, sid, vector);
          }
        });
        touchedSystems.forEach((system) => system.callUpdates(["instanceColor"]));
        render();
      }

      return {
        success: true,
        mutation: true,
        idsAffected: ids,
        color: color.getHexString(),
        applyTo: input.applyTo,
        verification: ids.slice(0, 25).map((id) => api.getElementInfo(api.getElement(id))),
      };
    },

    createHelixBundle(input) {
      const startingElementCount = elements.size;
      const helixCount = Math.max(1, input.numberOfHelices ?? 1);
      const basePairsPerHelix = Math.max(1, input.basePairsPerHelix ?? 32);
      const nucleicAcidType = input.nucleicAcidType ?? "DNA";
      const duplex = input.duplex ?? true;
      const spacing = input.spacing ?? 4;
      const randomizeHelixPhase = input.randomizeHelixPhase ?? true;
      const focusAfterCreate = input.focusAfterCreate ?? true;
      const labelPrefix = input.labelPrefix ?? "bundle";
      const lattice = getHexLatticeCoordinates(helixCount);

      const createdHelices = [];
      let anchorCenter = null;
      let bundleAxis = null;
      let basisU = null;
      let basisV = null;

      for (let index = 0; index < helixCount; index += 1) {
        const sequence = randomSequence(basePairsPerHelix, nucleicAcidType);
        const helixElements = edit.createStrand(
          sequence,
          duplex,
          nucleicAcidType === "RNA",
        );
        const helixSet = new Set(helixElements);
        const helixCenter = getElementCenter(helixElements);

        if (!anchorCenter) {
          anchorCenter = helixCenter.clone();
          bundleAxis = helixElements[0]?.getA3?.()?.clone?.()?.normalize?.()
            ?? new THREE.Vector3(0, 0, 1);
          [basisU, basisV] = getBundleBasis(bundleAxis);
        }

        const [q, r] = lattice[index];
        const x = spacing * (q + r / 2);
        const y = spacing * (Math.sqrt(3) * r / 2);
        const targetCenter = anchorCenter
          .clone()
          .add(basisU.clone().multiplyScalar(x))
          .add(basisV.clone().multiplyScalar(y));

        if (index > 0) {
          translateElements(helixSet, targetCenter.clone().sub(helixCenter));
        }

        const finalCenter = index > 0 ? targetCenter : helixCenter;
        if (randomizeHelixPhase) {
          rotateElements(
            helixSet,
            bundleAxis.clone(),
            Math.random() * Math.PI * 2,
            finalCenter.clone(),
          );
        }

        const strands = uniqueStrands(helixElements);
        strands.forEach((strand, strandIndex) => {
          strand.label = `${labelPrefix}_${index + 1}${strands.length > 1 ? String.fromCharCode(97 + strandIndex) : ""}`;
        });

        createdHelices.push({
          helixIndex: index + 1,
          sequence,
          elementIds: helixElements.map((element) => element.id),
          strandIds: strands.map((strand) => strand.id),
          center: finalCenter.toArray(),
        });
      }

      const createdElements = createdHelices.flatMap((helix) =>
        helix.elementIds.map((id) => api.getElement(id)).filter(Boolean),
      );
      const createdIds = createdElements.map((element) => element.id);
      if (createdIds.length === 0) {
        return {
          success: false,
          mutation: false,
          helixCount,
          basePairsPerHelix,
          nucleicAcidType,
          duplex,
          spacing,
          focusAfterCreate,
          idsAffected: [],
          error: "Helix bundle creation reported success, but no created elements were resolvable in the scene.",
        };
      }

      if (typeof api.showEverything === "function") {
        api.showEverything();
      }
      if (typeof api.selectElements === "function") {
        api.selectElements(createdElements, false);
      }

      const bundleCenter = getElementCenter(createdElements);

      if (focusAfterCreate) {
        const bundleRadius = Math.max(
          spacing * Math.sqrt(Math.max(1, helixCount)),
          basePairsPerHelix * 0.35,
          20,
        );
        focusCameraOnPoint(bundleCenter, bundleRadius * 2);
      }

      return {
        success: true,
        mutation: true,
        helixCount,
        basePairsPerHelix,
        nucleicAcidType,
        duplex,
        spacing,
        focusAfterCreate,
        bundleCenter: bundleCenter.toArray(),
        sceneElementCountBefore: startingElementCount,
        sceneElementCountAfter: elements.size,
        strandCount: createdHelices.reduce((count, helix) => count + helix.strandIds.length, 0),
        elementCount: createdIds.length,
        idsAffected: createdIds,
        selectedIds: api.getSelectedElementIDs ? api.getSelectedElementIDs() : createdIds,
        createdHelices,
      };
    },

    focusElement(input) {
      const element = api.getElement(input.elementId);
      if (!element) {
        return {
          success: false,
          mutation: false,
          idsAffected: [],
          error: `Element ${input.elementId} was not found.`,
        };
      }
      api.findElement(element, input.steps);
      return {
        success: true,
        mutation: true,
        idsAffected: [input.elementId],
      };
    },

    toggleVisibility(input) {
      const ids = findElements(input.filter).map((element) => element.id);
      api.toggleElements(api.getElements(ids));
      return {
        success: true,
        mutation: true,
        idsAffected: ids,
      };
    },

    showEverything() {
      api.showEverything();
      return {
        success: true,
        mutation: true,
        idsAffected: [],
      };
    },

    toggleBaseColors() {
      api.toggleBaseColors();
      return {
        success: true,
        mutation: true,
        idsAffected: [],
      };
    },

    undo() {
      editHistory.undo();
      return {
        success: true,
        mutation: true,
        idsAffected: [],
      };
    },

    redo() {
      editHistory.redo();
      return {
        success: true,
        mutation: true,
        idsAffected: [],
      };
    },
  };
}

export const PAGE_HELPERS_SOURCE = `(${installOxViewLangGraphHelpers.toString()})();`;
