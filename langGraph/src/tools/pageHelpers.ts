// @ts-nocheck

function installOxViewLangGraphHelpers() {
  const state =
    globalThis.__oxviewLangGraphState ??
    {
      clipboard: [],
      clipboardUpdatedAt: null,
    };
  globalThis.__oxviewLangGraphState = state;

  const normalizeBaseTypes = (baseTypes) =>
    (baseTypes || []).map((value) => String(value).toUpperCase());

  const normalizeSequence = (sequence) =>
    String(sequence ?? "")
      .replace(/\s+/g, "")
      .toUpperCase();

  const resolveElementKind = (element) => {
    if (element?.isNucleotide?.()) return "nucleotide";
    if (element?.isAminoAcid?.()) return "aminoAcid";
    if (element?.isGS?.()) return "genericSphere";
    return "unknown";
  };

  const getAllElements = () => Array.from(elements.values()).filter(Boolean);
  const getAllSystems = () => Array.from(systems ?? []);
  const getAllStrands = () =>
    getAllSystems().flatMap((system) => Array.from(system?.strands ?? []));

  const resolveSystemById = (systemId) =>
    getAllSystems().find((system) => system?.id === systemId) ?? null;

  const resolveStrandById = (strandId) =>
    getAllStrands().find((strand) => strand?.id === strandId) ?? null;

  const resolveElementById = (elementId) => api.getElement(elementId) ?? null;
  const getAllNetworks = () => Array.from(networks ?? []).filter(Boolean);
  const getNetworkIndex = (network) => getAllNetworks().indexOf(network);
  const resolveNetworkById = (networkId) =>
    getAllNetworks().find((network) => network?.nid === networkId) ??
    getAllNetworks()[networkId] ??
    null;
  const getAllGraphDatasets = () => Array.from(graphDatasets ?? []).filter(Boolean);
  const resolveGraphDatasetById = (datasetId) => getAllGraphDatasets()[datasetId] ?? null;
  const getNamedSelections = () => Array.from(selectionListHandler?.selectionList ?? []);
  const getNamedSelectionByName = (name) =>
    getNamedSelections().find((selection) => selection?.name === name) ?? null;

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

  const isElementVisible = (element) => {
    try {
      return (element.getInstanceParameter3("visibility")?.x ?? 0) > 0;
    } catch (_error) {
      try {
        return (element.getInstanceParameter3("visibilities")?.x ?? 0) > 0;
      } catch (_innerError) {
        return true;
      }
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
    if (filter.systemIds && !filter.systemIds.includes(element.getSystem?.().id)) return false;
    if (filter.clusterIds && !filter.clusterIds.includes(element.clusterId)) return false;
    if (filter.selectedOnly && !selectedBases.has(element)) return false;
    if (filter.pairedOnly && !element.isPaired?.()) return false;
    if (filter.visibleOnly && !isElementVisible(element)) return false;
    if (filter.elementKinds && !filter.elementKinds.includes(resolveElementKind(element))) return false;
    if (filter.baseTypes) {
      const allowed = normalizeBaseTypes(filter.baseTypes);
      if (!allowed.includes(String(element.type).toUpperCase())) return false;
    }
    if (!matchesPredicate(element, filter.attributePredicate)) return false;
    return true;
  };

  const findElements = (filter = {}) => {
    const matches = getAllElements()
      .filter((element) => matchesFilter(element, filter))
      .sort((a, b) => a.id - b.id);

    return filter.limit ? matches.slice(0, filter.limit) : matches;
  };

  const getUniqueElementsByIds = (ids = []) =>
    Array.from(new Set(ids))
      .map((id) => resolveElementById(id))
      .filter(Boolean);

  const getColorVector = (color) => {
    const threeColor = new THREE.Color(color);
    return {
      color: threeColor,
      vector: [threeColor.r, threeColor.g, threeColor.b],
    };
  };

  const getTouchedSystems = (elementsToUpdate) => {
    const touched = new Set();
    elementsToUpdate.forEach((element) => {
      touched.add(element.dummySys ?? element.getSystem());
    });
    return Array.from(touched).filter(Boolean);
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

  const cloneNetworkEdges = (sourceEdges) => {
    const cloned = new Edges();
    cloned.p1 = [...(sourceEdges?.p1 ?? [])];
    cloned.p2 = [...(sourceEdges?.p2 ?? [])];
    cloned.ks = [...(sourceEdges?.ks ?? [])];
    cloned.types = [...(sourceEdges?.types ?? [])];
    cloned.eqDist = [...(sourceEdges?.eqDist ?? [])];
    cloned.extraParams = (sourceEdges?.extraParams ?? []).map((entry) =>
      Array.isArray(entry) ? [...entry] : entry,
    );
    cloned.total = sourceEdges?.total ?? cloned.p1.length;
    return cloned;
  };

  const collectForceElementIds = (value) => {
    if (value === null || value === undefined) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((entry) => collectForceElementIds(entry));
    }
    if (typeof value === "number") {
      return value >= 0 ? [value] : [];
    }
    if (typeof value?.id === "number") {
      return [value.id];
    }
    return [];
  };

  const getForceParticipantIds = (force) =>
    Array.from(
      new Set(
        [
          ...collectForceElementIds(force?.particle),
          ...collectForceElementIds(force?.ref_particle),
          ...collectForceElementIds(force?.particles),
          ...collectForceElementIds(force?.ref_particles),
          ...collectForceElementIds(force?.com_list),
          ...collectForceElementIds(force?.ref_list),
        ].filter((id) => typeof id === "number"),
      ),
    ).sort((a, b) => a - b);

  const serializeForce = (force, forceId) => ({
    forceId,
    type: force?.type ?? null,
    description: force?.description?.() ?? null,
    participantIds: getForceParticipantIds(force),
    serialized: force?.toString?.() ?? null,
  });

  const serializeNetwork = (network) => ({
    networkId: network?.nid ?? null,
    networkIndex: getNetworkIndex(network),
    particleIds: Array.from(network?.particles ?? []).map((element) => element.id),
    particleCount: network?.particles?.length ?? 0,
    edgeCount: network?.reducedEdges?.total ?? 0,
    networkType: network?.networktype ?? null,
    cutoff: network?.cutoff ?? null,
    fittingReady: Boolean(network?.fittingReady),
    visible: Boolean(network?.onscreen),
    selected:
      typeof selectednetwork === "number"
        ? selectednetwork === network?.nid || selectednetwork === getNetworkIndex(network)
        : false,
  });

  const serializeGraphDataset = (dataset, datasetId) => ({
    datasetId,
    label: dataset?.label ?? null,
    datatype: dataset?.datatype ?? null,
    units: dataset?.units ?? null,
    pointCount: dataset?.data?.length ?? 0,
    xCount: dataset?.xdata?.length ?? 0,
  });

  const serializeNamedSelection = (selection) => ({
    name: selection?.name ?? null,
    elementIds: Array.from(selection?.selectedBases ?? []).map((element) => element.id),
    count: selection?.selectedBases?.length ?? 0,
  });

  const rebuildForceScene = () => {
    if (!forceHandler) {
      return;
    }
    forceHandler.clearForcesFromScene?.();
    forceHandler.sceneObjects = [];
    forceHandler.forceLines = [];
    forceHandler.forcePlanes = [];
    forceHandler.sphereMeshes = [];
    forceHandler.boxMeshes = [];
    forceHandler.boxOutlines = [];
    forceHandler.eqDistLines = undefined;
    if (forceHandler.forces.length > 0) {
      forceHandler.drawTraps?.();
      forceHandler.drawPlanes?.();
      forceHandler.drawSpheres?.();
      forceHandler.drawBoxes?.();
      forceHandler.drawStrings?.();
    }
    listForces?.();
    render();
  };

  const captureTextDownloads = (callback) => {
    const originalMakeTextFile = globalThis.makeTextFile;
    const downloads = [];
    globalThis.makeTextFile = (filename, text) => {
      downloads.push({
        filename,
        mimeType: "text/plain",
        text: String(text),
      });
    };
    try {
      callback();
      return downloads;
    } finally {
      globalThis.makeTextFile = originalMakeTextFile;
    }
  };

  const parseForceText = (text) => {
    const trapObjs = [];
    String(text)
      .split("}")
      .forEach((trap) => {
        const lines = trap
          .replace("{", "")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "" && !line.startsWith("#"));
        if (lines.length === 0) {
          return;
        }

        const trapObj = {};
        lines.forEach((line) => {
          const commentIndex = line.indexOf("#");
          const cleanLine =
            commentIndex >= 0 ? line.slice(0, commentIndex).trim() : line.trim();
          if (!cleanLine) {
            return;
          }
          const [rawKey, ...rawValueParts] = cleanLine.split("=");
          if (!rawKey || rawValueParts.length === 0) {
            return;
          }
          const key = rawKey.trim();
          const valueText = rawValueParts.join("=").trim();
          if (valueText.includes(",")) {
            const numberList = valueText.split(",").map((entry) => Number(entry.trim()));
            trapObj[key] = numberList.every((entry) => !Number.isNaN(entry))
              ? numberList
              : valueText;
          } else if (/^-?\d+(\.\d+)?$/.test(valueText)) {
            trapObj[key] = Number(valueText);
          } else if (/^\d+(\s+\d+)+$/.test(valueText)) {
            trapObj[key] = valueText.split(/\s+/).map((entry) => Number(entry));
          } else {
            trapObj[key] = valueText;
          }
        });

        if (Object.keys(trapObj).length > 0) {
          trapObjs.push(trapObj);
        }
      });

    return trapObjs.map((parsed) => {
      switch (parsed.type) {
        case "mutual_trap": {
          const force = new MutualTrap();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "sphere": {
          const force = new RepulsiveSphere();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "skew_trap": {
          const force = new SkewTrap();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "com": {
          const force = new COMForce();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "repulsion_plane": {
          const force = new RepulsionPlane();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "attraction_plane": {
          const force = new AttractionPlane();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "repulsion_plane_moving": {
          const force = new RepulsionPlaneMoving();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "repulsive_sphere_moving": {
          const force = new RepulsiveSphereMoving();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "AFMMovingSphere": {
          const force = new AFMMovingSphere();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "ellipsoid": {
          const force = new RepulsiveEllipsoid();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "Box": {
          const force = new Box();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "string": {
          const force = new StringForce();
          force.setFromParsedJson(parsed);
          return force;
        }
        case "repulsive_kepler_poinsot": {
          const force = new RepulsiveKeplerPoinsot();
          force.setFromParsedJson(parsed);
          return force;
        }
        default:
          throw new Error(`Unsupported force type: ${parsed.type}`);
      }
    });
  };

  const snapshotSceneCounts = () => ({
    systemCount: getAllSystems().length,
    strandCount: getAllStrands().length,
    elementCount: elements.size,
    selectedCount: selectedBases.size,
    hiddenCount: getAllElements().filter((element) => !isElementVisible(element)).length,
    clipboardCount: state.clipboard.length,
    forceCount: forceHandler?.forces?.length ?? 0,
    networkCount: getAllNetworks().length,
    namedSelectionCount: getNamedSelections().length,
    graphDatasetCount: getAllGraphDatasets().length,
    clusterCount: typeof clusterCounter === "number" ? clusterCounter : 0,
  });

  const success = (payload = {}) => ({
    success: true,
    ...snapshotSceneCounts(),
    ...payload,
  });

  const failure = (error, payload = {}) => ({
    success: false,
    error,
    ...snapshotSceneCounts(),
    ...payload,
  });

  const vectorFromInput = (input, fallback) =>
    input
      ? new THREE.Vector3(Number(input.x ?? 0), Number(input.y ?? 0), Number(input.z ?? 0))
      : fallback?.clone?.() ?? new THREE.Vector3();

  const averagePosition = (elementsToAverage, target = "center") => {
    const validPositions = elementsToAverage
      .map((element) => api.getElementPosition(element, target))
      .filter(Boolean);
    const center = new THREE.Vector3();
    if (validPositions.length === 0) {
      return center;
    }
    validPositions.forEach((position) => center.add(position));
    return center.divideScalar(validPositions.length);
  };

  const captureAdditionUndoState = (addedElements) => {
    const instanceCopies = addedElements.map((element) => new InstanceCopy(element));
    const position = averagePosition(addedElements, "center");
    return { instanceCopies, position };
  };

  const markTopologyEdited = () => {
    if (typeof topologyEdited !== "undefined") {
      topologyEdited = true;
    }
  };

  const getCurrentProjection = () =>
    camera instanceof THREE.OrthographicCamera ? "orthographic" : "perspective";

  const getSelectionMode = () =>
    typeof selectionMode === "string" ? selectionMode : "Disabled";

  const getSelectPairs = () => {
    if (view?.selectPairs) {
      return view.selectPairs();
    }
    return Boolean(document.getElementById("selectPairs")?.classList.contains("active"));
  };

  const setSelectPairs = (enabled) => {
    const button = document.getElementById("selectPairs");
    if (button) {
      button.classList.toggle("active", Boolean(enabled));
    }
    const checkbox = document.getElementById("selectPairs2");
    if (checkbox) {
      checkbox.checked = Boolean(enabled);
    }
  };

  const setSelectionModeExplicit = (mode) => {
    const container = document.getElementById("selection-modes");
    if (container) {
      Array.from(container.children).forEach((button) => {
        const active = mode !== "Disabled" && button.getAttribute("title") === mode;
        button.classList.toggle("active", active);
      });
    }
    selectionMode = mode;
  };

  const getColorbarVisible = () => (colorbarScene?.children?.length ?? 0) > 0;

  const getAxesVisible = () => Boolean(scene.getObjectByName("x-axis")?.visible);

  const getBoxVisible = () => Boolean(typeof boxObj !== "undefined" && boxObj && boxObj.visible);

  const getFogState = () =>
    scene.fog
      ? { enabled: true, near: scene.fog.near, far: scene.fog.far }
      : { enabled: false, near: null, far: null };

  const getBackgroundColor = () => {
    const input = document.getElementById("backgroundColor");
    const canvasElement = document.getElementById("threeCanvas");
    return input?.value ?? canvasElement?.style?.background ?? "#ffffff";
  };

  const getComponentVisibility = (component) => {
    const systemList = [...getAllSystems(), ...(tmpSystems ?? [])];
    if (systemList.length === 0) {
      return null;
    }
    return systemList.some((system) => scene.children.includes(system?.[component]));
  };

  const getComponentScale = (component) => {
    switch (component) {
      case "backbone":
        return view?.backboneScale ?? 1;
      case "nucleoside":
        return view?.nucleosideScale ?? 1;
      case "connector":
        return view?.connectorScale ?? 1;
      case "bbconnector":
        return view?.bbconnectorScale ?? 1;
      default:
        return 1;
    }
  };

  const isBaseColorGray = () => {
    const nucleotide = getAllElements().find((element) => element?.isNucleotide?.());
    if (!nucleotide) {
      return false;
    }
    const tmp = nucleotide.getInstanceParameter3("nsColors");
    const actual = [tmp.x.toPrecision(6), tmp.y.toPrecision(6), tmp.z.toPrecision(6)];
    const gray = [GREY.r.toPrecision(6), GREY.g.toPrecision(6), GREY.b.toPrecision(6)];
    return JSON.stringify(actual) === JSON.stringify(gray);
  };

  const focusPoint = (point, distance = 10) => {
    const currentDirection = camera.position.clone().sub(controls.target);
    if (currentDirection.lengthSq() === 0) {
      currentDirection.set(0, 0, 1);
    }
    currentDirection.setLength(distance);
    camera.position.copy(point.clone().add(currentDirection));
    if (controls?.target?.copy) {
      controls.target.copy(point);
    } else {
      controls.target = point.clone();
    }
    render();
  };

  const setVisibility = (targetElements, visible) => {
    const changedIds = [];
    getTouchedSystems(targetElements).forEach((system) => {
      if (!system) return;
    });
    targetElements.forEach((element) => {
      if (isElementVisible(element) !== visible) {
        element.toggleVisibility();
        changedIds.push(element.id);
      }
    });
    getTouchedSystems(targetElements).forEach((system) =>
      system.callUpdates(["instanceVisibility"]),
    );
    render();
    return changedIds;
  };

  const serializeMonomer = (element) => ({
    id: element.id,
    type: element.type,
    pairId: element.isPaired?.() && element.pair ? element.pair.id : null,
    selected: selectedBases.has(element),
    visible: isElementVisible(element),
  });

  const serializeStrand = (strand, input = {}) => {
    const monomers = Array.from(strand.getMonomers?.() ?? strand);
    const cappedMonomers =
      input.includeMonomers && input.maxMonomersPerStrand
        ? monomers.slice(0, input.maxMonomersPerStrand)
        : monomers;

    return {
      id: strand.id,
      label: strand.label ?? null,
      systemId: strand.system?.id ?? null,
      length: strand.getLength?.() ?? monomers.length,
      end5Id: strand.end5?.id ?? null,
      end3Id: strand.end3?.id ?? null,
      sequence: strand.getSequence?.() ?? null,
      monomers:
        input.includeMonomers
          ? cappedMonomers.map((element) => serializeMonomer(element))
          : undefined,
      monomerCountReturned: input.includeMonomers ? cappedMonomers.length : undefined,
      monomerCountOmitted:
        input.includeMonomers && input.maxMonomersPerStrand
          ? Math.max(0, monomers.length - cappedMonomers.length)
          : 0,
    };
  };

  const getSceneState = () => ({
    ...snapshotSceneCounts(),
    selectedIds: api.getSelectedElementIDs ? api.getSelectedElementIDs() : Array.from(selectedBases).map((e) => e.id),
    coloringMode: view?.coloringMode?.get?.() ?? null,
    transformMode: view?.transformMode?.get?.() ?? null,
    cameraType: camera?.type ?? null,
    cameraProjection: getCurrentProjection(),
    backgroundColor: getBackgroundColor(),
    selectionMode: getSelectionMode(),
    selectPairs: getSelectPairs(),
    colorbarVisible: getColorbarVisible(),
    axesVisible: getAxesVisible(),
    boxVisible: getBoxVisible(),
    fog: getFogState(),
    cameraPosition: camera?.position?.toArray?.() ?? null,
    cameraTarget: controls?.target?.toArray?.() ?? null,
    componentVisibility: {
      backbone: getComponentVisibility("backbone"),
      nucleoside: getComponentVisibility("nucleoside"),
      connector: getComponentVisibility("connector"),
      bbconnector: getComponentVisibility("bbconnector"),
    },
    componentScale: {
      backbone: getComponentScale("backbone"),
      nucleoside: getComponentScale("nucleoside"),
      connector: getComponentScale("connector"),
      bbconnector: getComponentScale("bbconnector"),
    },
    selectedNetwork: typeof selectednetwork === "number" ? selectednetwork : null,
    networks: getAllNetworks().map((network) => serializeNetwork(network)),
    namedSelections: getNamedSelections().map((selection) => serializeNamedSelection(selection)),
    clipboardCount: state.clipboard.length,
    apiErrors: api.getErrorHistory ? api.getErrorHistory() : [],
  });

  globalThis.__oxviewLangGraphHelpers = {
    getSceneSummary(input = {}) {
      const sceneState = getSceneState();
      return {
        systemCount: sceneState.systemCount,
        elementCount: sceneState.elementCount,
        selectedIds: input.includeSelection === false ? [] : sceneState.selectedIds,
        coloringMode: sceneState.coloringMode,
        transformMode: sceneState.transformMode,
        cameraType: sceneState.cameraType,
        hiddenCount: sceneState.hiddenCount,
        clipboardCount: sceneState.clipboardCount,
        forceCount: sceneState.forceCount,
        networkCount: sceneState.networkCount,
        namedSelectionCount: sceneState.namedSelectionCount,
        graphDatasetCount: sceneState.graphDatasetCount,
        apiErrors: sceneState.apiErrors,
      };
    },

    getSceneState(_input = {}) {
      return getSceneState();
    },

    getSystemHierarchy(input = {}) {
      return {
        systems: getAllSystems().map((system) => ({
          id: system.id,
          strandCount: Array.from(system.strands ?? []).length,
          strands: Array.from(system.strands ?? []).map((strand) => serializeStrand(strand, input)),
        })),
      };
    },

    findElements(input) {
      const ids = findElements(input.filter).map((element) => element.id);
      return { ids, count: ids.length, filter: input.filter };
    },

    getElementInfo(input) {
      const element = resolveElementById(input.elementId);
      return element ? api.getElementInfo(element) : null;
    },

    getDistance(input) {
      const first = resolveElementById(input.firstElementId);
      const second = resolveElementById(input.secondElementId);
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
      const targetElements = findElements(input.filter);
      return {
        ids: targetElements.map((element) => element.id),
        target: input.target,
        center: averagePosition(targetElements, input.target).toArray(),
      };
    },

    getSequenceFromElements(input) {
      const targetElements = getUniqueElementsByIds(input.elementIds);
      return {
        elementIds: targetElements.map((element) => element.id),
        sequence: edit.getSequence(new Set(targetElements)),
      };
    },

    getStrandSequence(input) {
      const strand =
        input.strandId !== undefined
          ? resolveStrandById(input.strandId)
          : resolveElementById(input.elementId)?.strand ?? null;
      if (!strand) {
        return failure("No strand matched the requested identifier.");
      }
      return success({
        strandId: strand.id,
        systemId: strand.system?.id ?? null,
        sequence: api.getSequence(strand),
        length: strand.getLength?.() ?? null,
      });
    },

    traceStrand(input) {
      const element = resolveElementById(input.elementId);
      if (!element) {
        return failure(`Element ${input.elementId} was not found.`);
      }
      let start = element;
      if (input.direction === "5to3") {
        while (start.n5) {
          start = start.n5;
        }
        const traced = api.trace53(start);
        return success({
          direction: input.direction,
          strandId: element.strand?.id ?? null,
          ids: traced.map((entry) => entry.id),
          sequence: traced.map((entry) => entry.type).join(""),
        });
      }

      while (start.n3) {
        start = start.n3;
      }
      const traced = api.trace35(start);
      return success({
        direction: input.direction,
        strandId: element.strand?.id ?? null,
        ids: traced.map((entry) => entry.id),
        sequence: traced.map((entry) => entry.type).join(""),
      });
    },

    countStrandLengths(input = {}) {
      const system = input.systemId !== undefined ? resolveSystemById(input.systemId) : systems[0];
      if (!system) {
        return failure("No matching system was found.");
      }
      const counts = api.countStrandLength(system);
      const serialized = Object.fromEntries(
        Object.entries(counts).map(([length, strands]) => [
          length,
          strands.map((strand) => strand.id),
        ]),
      );
      return success({
        systemId: system.id,
        lengths: serialized,
      });
    },

    getApiErrors() {
      return {
        last: api.getLastError ? api.getLastError() : null,
        history: api.getErrorHistory ? api.getErrorHistory() : [],
      };
    },

    clearApiErrors() {
      api.clearErrorHistory?.();
      return success();
    },

    selectElements(input) {
      const ids = findElements(input.filter).map((element) => element.id);
      api.selectElements(api.getElements(ids), input.mode === "add");
      return success({
        idsAffected: ids,
        selectedIds: api.getSelectedElementIDs ? api.getSelectedElementIDs() : ids,
      });
    },

    clearSelection() {
      clearSelection();
      return success({
        idsAffected: [],
        selectedIds: [],
      });
    },

    selectEnds(input) {
      const strands =
        input.strandIds?.length
          ? input.strandIds.map((strandId) => resolveStrandById(strandId)).filter(Boolean)
          : input.systemId !== undefined
            ? Array.from(resolveSystemById(input.systemId)?.strands ?? [])
            : getAllStrands();
      const endElements = strands
        .map((strand) => (input.which === "5p" ? strand.end5 : strand.end3))
        .filter(Boolean);
      api.selectElements(endElements, input.mode === "add");
      return success({
        which: input.which,
        idsAffected: endElements.map((element) => element.id),
        selectedIds: api.getSelectedElementIDs ? api.getSelectedElementIDs() : endElements.map((element) => element.id),
      });
    },

    selectByPdbResidues(input) {
      const residueNumbers = input.residues.map((entry) => entry.residueNumber);
      const chainIds = input.residues.some((entry) => entry.chainId)
        ? input.residues.map((entry) => entry.chainId ?? "")
        : undefined;
      api.selectPDBIDs(residueNumbers, chainIds, input.mode === "add");
      return success({
        selectedIds: api.getSelectedElementIDs ? api.getSelectedElementIDs() : [],
      });
    },

    setSelectionMode(input) {
      setSelectionModeExplicit(input.mode);
      if (typeof input.selectPairs === "boolean") {
        setSelectPairs(input.selectPairs);
      }
      return success({
        selectionMode: getSelectionMode(),
        selectPairs: getSelectPairs(),
      });
    },

    colorElements(input) {
      const elementsToColor = findElements(input.filter);
      if (elementsToColor.length === 0) {
        return failure("No elements matched the requested filter.");
      }
      const ids = elementsToColor.map((element) => element.id);
      const { color, vector } = getColorVector(input.color);

      if (input.applyTo === "custom") {
        elementsToColor.forEach((element) => {
          element.color = color;
        });
        updateColoring("Custom");
      } else {
        const touchedSystems = getTouchedSystems(elementsToColor);
        elementsToColor.forEach((element) => {
          const system = element.dummySys ?? element.getSystem();
          const sid = element.sid;
          if (input.applyTo === "base") {
            system.fillVec("nsColors", 3, sid, vector);
          } else {
            system.fillVec("bbColors", 3, sid, vector);
          }
        });
        touchedSystems.forEach((system) => system.callUpdates(["instanceColor"]));
        render();
      }

      return success({
        idsAffected: ids,
        color: color.getHexString(),
        applyTo: input.applyTo,
      });
    },

    resetCustomColoring() {
      resetCustomColoring();
      return success({
        coloringMode: view?.coloringMode?.get?.() ?? null,
      });
    },

    setColoringMode(input) {
      if (input.mode === "Overlay" && !lut) {
        return failure("Overlay coloring is unavailable because no LUT/overlay data is loaded.");
      }
      updateColoring(input.mode);
      return success({
        coloringMode: view?.coloringMode?.get?.() ?? null,
        colorbarVisible: getColorbarVisible(),
      });
    },

    setColorbarVisible(input) {
      if (input.visible && !lut) {
        return failure("A colorbar cannot be shown because no overlay LUT is loaded.");
      }
      if (input.visible) {
        api.showColorbar();
      } else {
        api.removeColorbar();
      }
      return success({
        colorbarVisible: getColorbarVisible(),
      });
    },

    setOverlayColormap(input) {
      if (!lut) {
        return failure("No overlay LUT is loaded, so the colormap cannot be changed.");
      }
      api.changeColormap(input.name);
      return success({
        colormap: input.name,
      });
    },

    setOverlayBounds(input) {
      if (!lut) {
        return failure("No overlay LUT is loaded, so overlay bounds cannot be changed.");
      }
      api.setColorBounds(input.min, input.max);
      return success({
        min: input.min,
        max: input.max,
      });
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
      const element = resolveElementById(input.elementId);
      if (!element) {
        return failure(`Element ${input.elementId} was not found.`);
      }
      api.findElement(element, input.steps);
      return success({
        idsAffected: [input.elementId],
      });
    },

    focusFilter(input) {
      const targetElements = findElements(input.filter);
      if (targetElements.length === 0) {
        return failure("No elements matched the requested filter.");
      }
      focusPoint(averagePosition(targetElements, input.target), input.distance);
      return success({
        idsAffected: targetElements.map((element) => element.id),
      });
    },

    setElementVisibility(input) {
      const targetElements = findElements(input.filter);
      if (targetElements.length === 0) {
        return failure("No elements matched the requested filter.");
      }
      return success({
        idsAffected: setVisibility(targetElements, input.visible),
        visible: input.visible,
      });
    },

    setStrandVisibility(input) {
      const strands = input.strandIds.map((strandId) => resolveStrandById(strandId)).filter(Boolean);
      if (strands.length === 0) {
        return failure("No matching strands were found.");
      }
      const strandElements = strands.flatMap((strand) => Array.from(strand.getMonomers?.() ?? strand));
      return success({
        idsAffected: setVisibility(strandElements, input.visible),
        visible: input.visible,
        strandIds: strands.map((strand) => strand.id),
      });
    },

    restoreHiddenElements() {
      return success({
        idsAffected: setVisibility(getAllElements(), true),
        visible: true,
      });
    },

    setComponentVisibility(input) {
      view.setPropertyInScene(input.component, undefined, input.visible);
      return success({
        component: input.component,
        visible: getComponentVisibility(input.component),
      });
    },

    setComponentScale(input) {
      view.setComponentScale(input.component, input.scale);
      return success({
        component: input.component,
        scale: getComponentScale(input.component),
      });
    },

    setBaseColorMode(input) {
      const currentlyGray = isBaseColorGray();
      const shouldBeGray = input.mode === "gray";
      if (currentlyGray !== shouldBeGray) {
        api.toggleBaseColors();
      }
      return success({
        mode: shouldBeGray ? "gray" : "default",
      });
    },

    setRenderPreset(input) {
      if (input.preset === "spOnly") {
        api.spOnly();
      } else {
        api.showEverything();
      }
      return success({
        preset: input.preset,
      });
    },

    setCameraProjection(input) {
      if (getCurrentProjection() !== input.projection) {
        api.switchCamera();
      }
      return success({
        projection: getCurrentProjection(),
      });
    },

    setBackgroundColor(input) {
      const backgroundInput = document.getElementById("backgroundColor");
      if (backgroundInput) {
        backgroundInput.value = input.color;
      }
      api.setBackgroundColor(input.color);
      return success({
        backgroundColor: getBackgroundColor(),
      });
    },

    setAxesVisible(input) {
      if (typeof setArrowsVisibility === "function") {
        setArrowsVisibility(input.visible);
        render();
      }
      const checkbox = document.getElementById("arrowToggle");
      if (checkbox) {
        checkbox.checked = Boolean(input.visible);
      }
      return success({
        axesVisible: getAxesVisible(),
      });
    },

    setBoxVisible(input) {
      const checkbox =
        document.querySelector('input[data-caption="Box"]') ??
        document.getElementById("boxToggle");
      if (checkbox) {
        checkbox.checked = Boolean(input.visible);
      }
      if (typeof toggleBox === "function" && checkbox) {
        toggleBox(checkbox);
      } else {
        if (input.visible && typeof redrawBox === "function") {
          redrawBox();
        }
        if (typeof boxObj !== "undefined" && boxObj) {
          boxObj.visible = Boolean(input.visible);
          render();
        }
      }
      return success({
        boxVisible: getBoxVisible(),
      });
    },

    setFog(input) {
      const fogCheckbox = document.querySelector('input[data-caption="Fog"]');
      if (fogCheckbox) {
        fogCheckbox.checked = Boolean(input.enabled);
      }
      if (!input.enabled) {
        scene.fog = null;
        render();
        return success({
          fog: getFogState(),
        });
      }
      const near = Number(input.near ?? document.getElementById("fogNear")?.value ?? 1);
      const far = Number(input.far ?? document.getElementById("fogFar")?.value ?? 200);
      const nearInput = document.getElementById("fogNear");
      const farInput = document.getElementById("fogFar");
      if (nearInput) nearInput.value = String(near);
      if (farInput) farInput.value = String(far);
      scene.fog = new THREE.Fog(new THREE.Color(getBackgroundColor()).getHex(), near, far);
      render();
      return success({
        fog: getFogState(),
      });
    },

    set3PrimeMarkers(input) {
      const checkbox = document.getElementById("marker3pToggle");
      if (checkbox) {
        checkbox.checked = Boolean(input.enabled);
      }
      api.update3primeMarkers(input.diameter, input.length, input.spacing);
      return success({
        enabled: Boolean(input.enabled),
      });
    },

    translateElements(input) {
      const targetElements = findElements(input.filter);
      if (targetElements.length === 0) {
        return failure("No elements matched the requested filter.");
      }
      const translation = vectorFromInput(input.vector);
      editHistory.do(new RevertableTranslation(new Set(targetElements), translation));
      return success({
        idsAffected: targetElements.map((element) => element.id),
        vector: translation.toArray(),
      });
    },

    rotateElements(input) {
      const targetElements = findElements(input.filter);
      if (targetElements.length === 0) {
        return failure("No elements matched the requested filter.");
      }
      const axis = vectorFromInput(input.axis);
      if (axis.lengthSq() === 0) {
        return failure("Rotation axis must be non-zero.");
      }
      axis.normalize();
      const about = input.about ? vectorFromInput(input.about) : averagePosition(targetElements, "center");
      editHistory.do(
        new RevertableRotation(
          new Set(targetElements),
          axis,
          (Number(input.angleDegrees) * Math.PI) / 180,
          about,
        ),
      );
      return success({
        idsAffected: targetElements.map((element) => element.id),
        axis: axis.toArray(),
        angleDegrees: Number(input.angleDegrees),
      });
    },

    moveElementsTo(input) {
      const target = resolveElementById(input.targetElementId);
      const movedElements = getUniqueElementsByIds(input.elementIds);
      if (!target) {
        return failure(`Element ${input.targetElementId} was not found.`);
      }
      if (movedElements.length === 0) {
        return failure("No movable elements were found.");
      }
      const anchor =
        (input.anchorElementId !== undefined && resolveElementById(input.anchorElementId)) ||
        movedElements[0];
      const translation = target.getPos().clone().sub(anchor.getPos());
      editHistory.do(new RevertableTranslation(new Set(movedElements), translation));
      return success({
        idsAffected: movedElements.map((element) => element.id),
        vector: translation.toArray(),
      });
    },

    toggleVisibility(input) {
      const ids = findElements(input.filter).map((element) => element.id);
      api.toggleElements(api.getElements(ids));
      return success({
        idsAffected: ids,
      });
    },

    showEverything() {
      api.showEverything();
      return success();
    },

    toggleBaseColors() {
      api.toggleBaseColors();
      return success({
        mode: isBaseColorGray() ? "gray" : "default",
      });
    },

    switchCamera() {
      api.switchCamera();
      return success({
        projection: getCurrentProjection(),
      });
    },

    createStrand(input) {
      const sequence = normalizeSequence(input.sequence);
      if (!sequence) {
        return failure("Sequence is required.");
      }
      const addedElements = edit.createStrand(
        sequence,
        Boolean(input.duplex),
        String(input.polymerType).toUpperCase() === "RNA",
      );
      if (!addedElements?.length) {
        return failure("oxView did not create any elements.");
      }
      const { instanceCopies, position } = captureAdditionUndoState(addedElements);
      editHistory.add(new RevertableAddition(instanceCopies, addedElements, position));
      markTopologyEdited();
      render();
      return success({
        idsAffected: addedElements.map((element) => element.id),
        strandIds: Array.from(new Set(addedElements.map((element) => element.strand?.id).filter((id) => id !== undefined))),
      });
    },

    extendStrand(input) {
      const end = resolveElementById(input.endElementId);
      if (!end) {
        return failure(`Element ${input.endElementId} was not found.`);
      }
      const sequence = normalizeSequence(input.sequence);
      if (!sequence) {
        return failure("Sequence is required.");
      }
      const addedElements = edit.extendStrand(end, sequence);
      if (!addedElements?.length) {
        return failure("The strand could not be extended from that element.");
      }
      const { instanceCopies, position } = captureAdditionUndoState(addedElements);
      editHistory.add(new RevertableAddition(instanceCopies, addedElements, position));
      markTopologyEdited();
      return success({
        idsAffected: addedElements.map((element) => element.id),
      });
    },

    extendDuplex(input) {
      const end = resolveElementById(input.endElementId);
      if (!end) {
        return failure(`Element ${input.endElementId} was not found.`);
      }
      if (!end.isNucleotide?.()) {
        return failure("Duplex extension requires a nucleotide element.");
      }
      const sequence = normalizeSequence(input.sequence);
      if (!sequence) {
        return failure("Sequence is required.");
      }
      let addedElements = [];
      if (input.semantics === "raw") {
        addedElements = edit.extendDuplex(end, sequence) ?? [];
      } else {
        const firstBase = sequence[0];
        const remainder = sequence.slice(1);
        const initial = edit.extendStrand(end, firstBase) ?? [];
        if (!initial.length) {
          return failure("The duplex could not be extended from that element.");
        }
        addedElements = addedElements.concat(initial);
        addedElements = addedElements.concat(edit.extendDuplex(initial[0], remainder) ?? []);
      }
      if (!addedElements.length) {
        return failure("The duplex extension did not create any elements.");
      }
      const { instanceCopies, position } = captureAdditionUndoState(addedElements);
      editHistory.add(new RevertableAddition(instanceCopies, addedElements, position));
      markTopologyEdited();
      return success({
        idsAffected: addedElements.map((element) => element.id),
      });
    },

    insertAfter(input) {
      const element = resolveElementById(input.elementId);
      if (!element) {
        return failure(`Element ${input.elementId} was not found.`);
      }
      const sequence = normalizeSequence(input.sequence);
      if (!sequence) {
        return failure("Sequence is required.");
      }
      const addedElements = edit.insert(element, sequence) ?? [];
      if (!addedElements.length) {
        return failure("The insert operation did not create any elements.");
      }
      markTopologyEdited();
      return success({
        idsAffected: addedElements.map((entry) => entry.id),
      });
    },

    skipElements(input) {
      const targetElements = getUniqueElementsByIds(input.elementIds);
      if (targetElements.length === 0) {
        return failure("No elements were found to skip.");
      }
      edit.skip(targetElements);
      markTopologyEdited();
      return success({
        idsAffected: targetElements.map((element) => element.id),
      });
    },

    deleteElements(input) {
      const targetElements = getUniqueElementsByIds(input.elementIds);
      if (targetElements.length === 0) {
        return failure("No elements were found to delete.");
      }
      clearSelection();
      editHistory.do(new RevertableDeletion(targetElements));
      markTopologyEdited();
      return success({
        idsAffected: targetElements.map((element) => element.id),
      });
    },

    nick(input) {
      const element = resolveElementById(input.elementId);
      if (!element) {
        return failure(`Element ${input.elementId} was not found.`);
      }
      editHistory.do(new RevertableNick(element));
      markTopologyEdited();
      return success({
        idsAffected: [element.id],
      });
    },

    ligate(input) {
      const first = resolveElementById(input.firstElementId);
      const second = resolveElementById(input.secondElementId);
      if (!first || !second) {
        return failure("Both ligation targets must exist.");
      }
      editHistory.do(new RevertableLigation(first, second));
      markTopologyEdited();
      return success({
        idsAffected: [first.id, second.id],
      });
    },

    setSequence(input) {
      const targetElements = getUniqueElementsByIds(input.elementIds);
      if (targetElements.length === 0) {
        return failure("No elements were found to retarget.");
      }
      const sequence = normalizeSequence(input.sequence);
      if (!sequence) {
        return failure("Sequence is required.");
      }
      if (sequence.length < targetElements.length) {
        return failure("The provided sequence is shorter than the selected element set.");
      }
      editHistory.do(
        new RevertableSequenceEdit(new Set(targetElements), sequence, Boolean(input.updateComplement)),
      );
      markTopologyEdited();
      return success({
        idsAffected: targetElements.map((element) => element.id),
        sequence,
      });
    },

    createBasePair(input) {
      const element = resolveElementById(input.elementId);
      if (!element) {
        return failure(`Element ${input.elementId} was not found.`);
      }
      if (!element.isNucleotide?.()) {
        return failure("Base-pair creation requires a nucleotide element.");
      }
      const created = edit.createBP(element, true);
      if (!created) {
        return failure("A base pair could not be created for that element.");
      }
      markTopologyEdited();
      return success({
        idsAffected: [created.id],
      });
    },

    interconnectDuplex(input) {
      const strand1 = resolveStrandById(input.strandId1);
      const strand2 = resolveStrandById(input.strandId2);
      if (!strand1 || !strand2) {
        return failure("Both strands must exist.");
      }
      const patchSequence = normalizeSequence(input.patchSequence);
      if (!patchSequence) {
        return failure("Patch sequence is required.");
      }
      if (input.end === "3p") {
        edit.interconnectDuplex3p(strand1, strand2, patchSequence);
      } else {
        edit.interconnectDuplex5p(strand1, strand2, patchSequence);
      }
      markTopologyEdited();
      return success({
        strandIds: [strand1.id, strand2.id],
      });
    },

    listForces(input = {}) {
      const typeFilter = input.type ? String(input.type) : null;
      const listedForces = Array.from(forceHandler?.forces ?? [])
        .map((force, forceId) => serializeForce(force, forceId))
        .filter((force) => (typeFilter ? force.type === typeFilter : true));
      return success({
        forces: input.limit ? listedForces.slice(0, input.limit) : listedForces,
      });
    },

    removeForces(input) {
      const existingForces = Array.from(forceHandler?.forces ?? []);
      if (existingForces.length === 0) {
        return failure("There are no forces to remove.");
      }
      const indicesToRemove = new Set(input.indices ?? []);
      const targetElementIds = new Set(input.elementIds ?? []);
      const removedForces = [];
      const retainedForces = existingForces.filter((force, index) => {
        if (input.all) {
          removedForces.push(serializeForce(force, index));
          return false;
        }
        if (indicesToRemove.has(index)) {
          removedForces.push(serializeForce(force, index));
          return false;
        }
        if (targetElementIds.size > 0) {
          const primaryIds = Array.from(
            new Set([
              ...collectForceElementIds(force?.particle),
              ...collectForceElementIds(force?.particles),
              ...collectForceElementIds(force?.com_list),
            ]),
          );
          const candidateIds = input.removePair ? getForceParticipantIds(force) : primaryIds;
          if (candidateIds.some((id) => targetElementIds.has(id))) {
            removedForces.push(serializeForce(force, index));
            return false;
          }
        }
        return true;
      });
      if (removedForces.length === 0) {
        return failure("No forces matched the requested removal criteria.");
      }
      forceHandler.forces = retainedForces;
      rebuildForceScene();
      return success({
        removedCount: removedForces.length,
        removedForces,
      });
    },

    createMutualTraps(input) {
      const newForces = [];
      const missingIds = [];
      input.pairs.forEach((pair) => {
        const particle = resolveElementById(pair.particleId);
        const refParticle = resolveElementById(pair.refParticleId);
        if (!particle || !refParticle) {
          missingIds.push([pair.particleId, pair.refParticleId]);
          return;
        }
        const forward = new MutualTrap();
        forward.set(particle, refParticle, input.stiff, input.r0, input.PBC);
        newForces.push(forward);
        if (input.bidirectional) {
          const reverse = new MutualTrap();
          reverse.set(refParticle, particle, input.stiff, input.r0, input.PBC);
          newForces.push(reverse);
        }
      });
      if (newForces.length === 0) {
        return failure("No valid force pairs were provided.", { missingIds });
      }
      forceHandler.set(newForces);
      listForces?.();
      return success({
        addedCount: newForces.length,
        addedForces: newForces.map((force, index) =>
          serializeForce(force, (forceHandler?.forces?.length ?? 0) - newForces.length + index),
        ),
        missingIds,
      });
    },

    createPairTrapsFromBasepairs(input) {
      const targetElements = findElements(input.filter);
      const existingSerialized = new Set(
        Array.from(forceHandler?.forces ?? []).map((force) => force?.toString?.() ?? ""),
      );
      const newForces = [];
      targetElements.forEach((element) => {
        if (!element?.isPaired?.() || !element.pair) {
          return;
        }
        const trap = new MutualTrap();
        trap.set(element, element.pair, input.stiff);
        const serialized = trap.toString();
        if (!existingSerialized.has(serialized)) {
          existingSerialized.add(serialized);
          newForces.push(trap);
        }
      });
      if (newForces.length === 0) {
        return failure("No new paired-base traps were created from the requested elements.");
      }
      forceHandler.set(newForces);
      listForces?.();
      return success({
        addedCount: newForces.length,
        idsAffected: targetElements.map((element) => element.id),
      });
    },

    createSphereForce(input) {
      const particles =
        input.particleIds?.length > 0 ? getUniqueElementsByIds(input.particleIds) : [];
      if (input.particleIds?.length && particles.length === 0) {
        return failure("No particle ids matched the requested sphere force.");
      }
      const center =
        input.center
          ? vectorFromInput(input.center)
          : particles.length > 0
            ? averagePosition(particles, "backbone")
            : new THREE.Vector3(0, 0, 0);
      const sphere = new RepulsiveSphere();
      sphere.set(
        particles.length > 0 ? particles : -1,
        input.stiff,
        input.r0,
        input.rate,
        center,
      );
      forceHandler.set([sphere]);
      listForces?.();
      return success({
        addedCount: 1,
        center: center.toArray(),
        particleIds: particles.map((element) => element.id),
      });
    },

    importForceText(input) {
      let parsedForces;
      try {
        parsedForces = parseForceText(input.text);
      } catch (error) {
        return failure(String(error));
      }
      if (parsedForces.length === 0) {
        return failure("The supplied force text did not contain any supported forces.");
      }
      const previousCount = forceHandler?.forces?.length ?? 0;
      if (input.replaceExisting) {
        forceHandler.clearForcesFromScene?.();
        forceHandler.forces = [];
        forceHandler.sceneObjects = [];
        forceHandler.forceLines = [];
        forceHandler.forcePlanes = [];
        forceHandler.sphereMeshes = [];
        forceHandler.boxMeshes = [];
        forceHandler.boxOutlines = [];
      }
      forceHandler.set(parsedForces);
      listForces?.();
      return success({
        replaceExisting: Boolean(input.replaceExisting),
        previousCount,
        addedCount: parsedForces.length,
        totalForces: forceHandler?.forces?.length ?? 0,
      });
    },

    exportForceText(input) {
      try {
        const useNew = input.topologyFormat === "new";
        const [newElementIDs] = input.remapToOxdnaIds ? getNewIds(useNew) : [undefined];
        const text = forcesToString(input.remapToOxdnaIds ? newElementIDs : undefined);
        return success({
          filename: input.filename,
          mimeType: "text/plain",
          text,
          remapToOxdnaIds: Boolean(input.remapToOxdnaIds),
        });
      } catch (error) {
        return failure(String(error));
      }
    },

    listNetworks() {
      return success({
        networks: getAllNetworks().map((network) => serializeNetwork(network)),
      });
    },

    createNetwork(input) {
      const targetElements = getUniqueElementsByIds(input.elementIds);
      if (targetElements.length === 0) {
        return failure("No elements were found for the new network.");
      }
      const networkId = getAllNetworks().length;
      editHistory.do(new RevertableNetworkCreation(targetElements, networkId));
      view.addNetwork?.(networkId);
      const createdNetwork = resolveNetworkById(networkId);
      return success({
        network: createdNetwork ? serializeNetwork(createdNetwork) : { networkId },
      });
    },

    deleteNetwork(input) {
      const network = resolveNetworkById(input.networkId);
      if (!network) {
        return failure(`Network ${input.networkId} was not found.`);
      }
      const networkIndex = getNetworkIndex(network);
      if (networkIndex < 0) {
        return failure(`Network ${input.networkId} is no longer addressable.`);
      }
      deleteNetworkWrapper(networkIndex);
      return success({
        deletedNetworkId: input.networkId,
      });
    },

    selectNetwork(input) {
      const network = resolveNetworkById(input.networkId);
      if (!network) {
        return failure(`Network ${input.networkId} was not found.`);
      }
      const networkIndex = getNetworkIndex(network);
      if (networkIndex < 0) {
        return failure(`Network ${input.networkId} is no longer addressable.`);
      }
      selectNetworkWrapper(networkIndex);
      return success({
        network: serializeNetwork(network),
        selectedIds: network.particles.map((element) => element.id),
      });
    },

    setNetworkVisibility(input) {
      const network = resolveNetworkById(input.networkId);
      if (!network) {
        return failure(`Network ${input.networkId} was not found.`);
      }
      if (input.visible && (network.reducedEdges?.total ?? 0) === 0) {
        return failure("That network has no edges yet, so there is nothing to visualize.");
      }
      if (Boolean(network.onscreen) !== Boolean(input.visible)) {
        network.toggleVis();
      }
      return success({
        network: serializeNetwork(network),
      });
    },

    copyNetwork(input) {
      const sourceNetwork = resolveNetworkById(input.sourceNetworkId);
      if (!sourceNetwork) {
        return failure(`Network ${input.sourceNetworkId} was not found.`);
      }
      const targetElements = getUniqueElementsByIds(input.targetElementIds);
      if (targetElements.length === 0) {
        return failure("No target elements were found for the network copy.");
      }
      if (targetElements.length !== (sourceNetwork.particles?.length ?? 0)) {
        return failure("Source and target network particle counts must match.");
      }
      const newNetworkId = getAllNetworks().length;
      editHistory.do(new RevertableNetworkCreation(targetElements, newNetworkId));
      const newNetwork = resolveNetworkById(newNetworkId);
      if (!newNetwork) {
        return failure("The new network could not be created.");
      }
      newNetwork.networktype = sourceNetwork.networktype;
      newNetwork.cutoff = sourceNetwork.cutoff;
      newNetwork.reducedEdges = cloneNetworkEdges(sourceNetwork.reducedEdges);
      if (newNetwork.reducedEdges.total !== 0) {
        newNetwork.initInstances(newNetwork.reducedEdges.total);
        newNetwork.fillConnections();
        newNetwork.initEdges();
        newNetwork.prepVis();
        newNetwork.sendtoUI();
      }
      view.addNetwork?.(newNetworkId);
      return success({
        sourceNetworkId: input.sourceNetworkId,
        network: serializeNetwork(newNetwork),
      });
    },

    fillNetworkEdges(input) {
      const network = resolveNetworkById(input.networkId);
      if (!network) {
        return failure(`Network ${input.networkId} was not found.`);
      }
      try {
        if (input.mode === "ANM") {
          if (typeof input.cutoffAngstroms !== "number") {
            return failure("ANM network filling requires cutoffAngstroms.");
          }
          network.edgesByCutoff(input.cutoffAngstroms);
        } else if (input.mode === "ANMT") {
          if (typeof input.cutoffAngstroms !== "number") {
            return failure("ANMT network filling requires cutoffAngstroms.");
          }
          network.edgesANMT(input.cutoffAngstroms);
        } else {
          network.edgesMWCENM();
        }
      } catch (error) {
        return failure(String(error), {
          network: serializeNetwork(network),
        });
      }
      return success({
        network: serializeNetwork(network),
      });
    },

    clearClusters() {
      const previousClusterCount = typeof clusterCounter === "number" ? clusterCounter : 0;
      clearClusters();
      return success({
        previousClusterCount,
        clusterCount: typeof clusterCounter === "number" ? clusterCounter : 0,
      });
    },

    runDbscan(input) {
      dbscan(input.minPts, input.epsilon);
      view.coloringMode.set("Cluster");
      const assignedClusterIds = Array.from(
        new Set(
          getAllElements()
            .map((element) => element.clusterId)
            .filter((clusterId) => clusterId !== undefined && clusterId !== null),
        ),
      ).sort((a, b) => a - b);
      return success({
        minPts: input.minPts,
        epsilon: input.epsilon,
        clusterIds: assignedClusterIds,
      });
    },

    selectionToCluster(input) {
      const targetElements = getUniqueElementsByIds(input.elementIds);
      if (targetElements.length === 0) {
        return failure("No elements were found for the new cluster.");
      }
      clusterCounter++;
      targetElements.forEach((element) => {
        element.clusterId = clusterCounter;
      });
      view.coloringMode.set("Cluster");
      return success({
        clusterId: clusterCounter,
        idsAffected: targetElements.map((element) => element.id),
      });
    },

    listNamedSelections() {
      return success({
        selections: getNamedSelections().map((selection) => serializeNamedSelection(selection)),
      });
    },

    saveNamedSelection(input) {
      const targetElements =
        input.elementIds?.length > 0
          ? getUniqueElementsByIds(input.elementIds)
          : Array.from(selectedBases);
      if (targetElements.length === 0) {
        return failure("No elements were provided for the named selection.");
      }
      const existing = getNamedSelectionByName(input.name);
      if (existing) {
        existing.selectedBases = [...targetElements];
        existing.name = input.name;
        if (existing.label) {
          existing.label.innerText = input.name;
        }
      } else {
        selectionListHandler.append(new Set(targetElements), input.name);
      }
      listSelections?.();
      return success({
        selection: serializeNamedSelection(getNamedSelectionByName(input.name)),
      });
    },

    applyNamedSelection(input) {
      const selection = getNamedSelectionByName(input.name);
      if (!selection) {
        return failure(`No named selection called "${input.name}" exists.`);
      }
      const targetElements = Array.from(selection.selectedBases ?? []).filter(Boolean);
      if (targetElements.length === 0) {
        return failure(`Named selection "${input.name}" is empty.`);
      }
      api.selectElements(targetElements, input.mode === "add");
      return success({
        selection: serializeNamedSelection(selection),
        selectedIds: api.getSelectedElementIDs ? api.getSelectedElementIDs() : targetElements.map((element) => element.id),
      });
    },

    deleteNamedSelection(input) {
      const selection = getNamedSelectionByName(input.name);
      if (!selection) {
        return failure(`No named selection called "${input.name}" exists.`);
      }
      selectionListHandler.delete(selection);
      listSelections?.();
      return success({
        deletedName: input.name,
      });
    },

    renameNamedSelection(input) {
      const selection = getNamedSelectionByName(input.oldName);
      if (!selection) {
        return failure(`No named selection called "${input.oldName}" exists.`);
      }
      selection.name = input.newName;
      if (selection.label) {
        selection.label.innerText = input.newName;
      }
      listSelections?.();
      return success({
        selection: serializeNamedSelection(selection),
      });
    },

    listGraphDatasets() {
      return success({
        datasets: getAllGraphDatasets().map((dataset, datasetId) =>
          serializeGraphDataset(dataset, datasetId),
        ),
      });
    },

    exportOxdnaBundle(input) {
      try {
        const useNew = input.topologyFormat === "new";
        const [newElementIDs, newStrandIds, counts, gsSubtypes] = getNewIds(useNew);
        const files = [];
        if (input.includeTop) {
          const { file_name, file } = makeTopFile(
            input.name,
            newElementIDs,
            newStrandIds,
            gsSubtypes,
            counts,
            useNew,
          );
          files.push({ filename: file_name, mimeType: "text/plain", text: file });
        }
        if (input.includeDat) {
          const { file_name, file } = makeDatFile(input.name, newElementIDs);
          files.push({ filename: file_name, mimeType: "text/plain", text: file });
        }
        if (input.includeMass && gsSubtypes.masses.length > 0) {
          files.push({
            filename: `${input.name}_m.txt`,
            mimeType: "text/plain",
            text: makeMassFile(newElementIDs, gsSubtypes),
          });
        }
        if (input.includePar && getAllNetworks().length > 0) {
          const { file_name, file } = makeParFile(input.name, newElementIDs, counts);
          files.push({ filename: file_name, mimeType: "text/plain", text: file });
        }
        if (input.includeForces && (forceHandler?.forces?.length ?? 0) > 0) {
          files.push({
            filename: `${input.name}_force.txt`,
            mimeType: "text/plain",
            text: forcesToString(newElementIDs),
          });
        }
        return success({
          name: input.name,
          topologyFormat: input.topologyFormat,
          files,
        });
      } catch (error) {
        return failure(String(error));
      }
    },

    exportOxViewJson(input) {
      const filename = `${input.name}.oxview`;
      const text = JSON.stringify(
        {
          date: new Date(),
          box: box.toArray(),
          systems,
          forces: forceHandler.forces,
          selections: selectionListHandler.serialize(),
        },
        null,
        input.pretty ? 2 : 0,
      );
      return success({
        filename,
        mimeType: "application/json",
        text,
      });
    },

    exportSequencesCsv(input = {}) {
      const lines = ["name, seq, len, RGB"];
      const strands = new Map();
      if (input.elementIds?.length > 0) {
        getUniqueElementsByIds(input.elementIds).forEach((element) => {
          if (element?.strand) {
            strands.set(element.strand.id, element.strand);
          }
        });
      } else {
        getAllStrands().forEach((strand) => {
          strands.set(strand.id, strand);
        });
      }
      Array.from(strands.values())
        .sort((left, right) => left.id - right.id)
        .forEach((strand) => {
          const label = strand.label ? strand.label : `strand_${strand.id}`;
          let line = `${label},${strand.getSequence()},${strand.getLength()}`;
          const color =
            strand.end5?.color ?? strand.end3?.color ?? null;
          if (color) {
            line += `,${Math.round(color.r * 255)}/${Math.round(color.g * 255)}/${Math.round(color.b * 255)}`;
          } else {
            line += ", ";
          }
          lines.push(line);
        });
      return success({
        filename: "sequences.csv",
        mimeType: "text/csv",
        text: lines.join("\n"),
      });
    },

    exportSelectedBasesText(input = {}) {
      const ids =
        input.elementIds?.length > 0
          ? getUniqueElementsByIds(input.elementIds).map((element) => element.id)
          : Array.from(selectedBases).map((element) => element.id);
      if (ids.length === 0) {
        return failure("There are no element ids to export.");
      }
      return success({
        filename: "selectedBases.txt",
        mimeType: "text/plain",
        text: ids.join(" "),
      });
    },

    exportIndexText(input) {
      if (!input.groups?.length) {
        return failure("At least one index group is required.");
      }
      return success({
        filename: input.filename,
        mimeType: "text/plain",
        text: input.groups.map((group) => group.join(" ")).join("\n"),
      });
    },

    exportNetworkJson(input) {
      const network = resolveNetworkById(input.networkId);
      if (!network) {
        return failure(`Network ${input.networkId} was not found.`);
      }
      return success({
        filename: "network.json",
        mimeType: "application/json",
        text: JSON.stringify(network.toJson()),
      });
    },

    exportFluctuationJson(input) {
      const dataset = resolveGraphDatasetById(input.datasetId);
      if (!dataset) {
        return failure(`Dataset ${input.datasetId} was not found.`);
      }
      return success({
        filename: "flux.json",
        mimeType: "application/json",
        text: JSON.stringify(dataset.toJson()),
        dataset: serializeGraphDataset(dataset, input.datasetId),
      });
    },

    exportUnfJson(input) {
      const downloads = captureTextDownloads(() => makeUNFOutput(input.name));
      const download = downloads[0];
      if (!download) {
        return failure("UNF export did not produce any output.");
      }
      return success({
        filename: `${input.name}.unf`,
        mimeType: "application/json",
        text: download.text,
      });
    },

    exportCameraState(input) {
      const payload = {
        position: camera.position,
        rotation: camera.rotation,
        up: camera.up,
        target: controls.target,
        projection: getCurrentProjection(),
      };
      return success({
        filename: input.filename,
        mimeType: "application/json",
        text: JSON.stringify(payload),
      });
    },

    copyElements(input) {
      const targetElements = getUniqueElementsByIds(input.elementIds);
      if (targetElements.length === 0) {
        return failure("No elements were found to copy.");
      }
      state.clipboard = targetElements.map((element) => new InstanceCopy(element));
      state.clipboardUpdatedAt = new Date().toISOString();
      return success({
        idsAffected: targetElements.map((element) => element.id),
        clipboardCount: state.clipboard.length,
      });
    },

    cutElements(input) {
      const targetElements = getUniqueElementsByIds(input.elementIds);
      if (targetElements.length === 0) {
        return failure("No elements were found to cut.");
      }
      state.clipboard = targetElements.map((element) => new InstanceCopy(element));
      state.clipboardUpdatedAt = new Date().toISOString();
      clearSelection();
      editHistory.do(new RevertableDeletion(targetElements));
      markTopologyEdited();
      return success({
        idsAffected: targetElements.map((element) => element.id),
        clipboardCount: state.clipboard.length,
      });
    },

    pasteElements(input = {}) {
      if (!state.clipboard.length) {
        return failure("The LangGraph clipboard is empty.");
      }
      let position = undefined;
      if (input.position) {
        position = vectorFromInput(input.position);
      } else if (!input.keepOriginalPosition) {
        const cameraHeading = new THREE.Vector3(0, 0, -1);
        cameraHeading.applyQuaternion(camera.quaternion);
        position = camera.position.clone().add(cameraHeading.multiplyScalar(20));
      }
      const clipboardSnapshot = state.clipboard.slice();
      const addedElements = edit.addElementsAt(clipboardSnapshot, position);
      editHistory.add(new RevertableAddition(clipboardSnapshot, addedElements, position));
      markTopologyEdited();
      api.selectElements(addedElements);
      return success({
        idsAffected: addedElements.map((element) => element.id),
        clipboardCount: state.clipboard.length,
      });
    },

    undo() {
      editHistory.undo();
      return success();
    },

    redo() {
      editHistory.redo();
      return success();
    },
  };
}

export const PAGE_HELPERS_SOURCE = `(${installOxViewLangGraphHelpers.toString()})();`;
