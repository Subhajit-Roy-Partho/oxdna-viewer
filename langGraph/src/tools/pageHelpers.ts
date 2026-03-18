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
