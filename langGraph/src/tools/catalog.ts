import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { OxViewCDPSession } from "../runtime/cdpSession.js";
import type { AvailableToolMetadata } from "../types.js";
import type { ToolRisk } from "./schemas.js";
import {
  ApplyNamedSelectionInputSchema,
  BackgroundColorInputSchema,
  CenterOfMassInputSchema,
  ChangeColormapInputSchema,
  ColorbarVisibleInputSchema,
  ColorBoundsInputSchema,
  ColorElementsInputSchema,
  CopyElementsInputSchema,
  CopyNetworkInputSchema,
  CountStrandLengthsInputSchema,
  CreateBasePairInputSchema,
  CreateHelixBundleInputSchema,
  CreateMutualTrapsInputSchema,
  CreateNetworkInputSchema,
  CreatePairTrapsFromBasepairsInputSchema,
  CreateSphereForceInputSchema,
  CreateStrandInputSchema,
  DeleteElementsInputSchema,
  DeleteNamedSelectionInputSchema,
  DistanceInputSchema,
  EmptyInputSchema,
  ExtendDuplexInputSchema,
  ExtendStrandInputSchema,
  ExportCameraStateInputSchema,
  ExportForceTextInputSchema,
  ExportFluctuationJsonInputSchema,
  ExportIndexTextInputSchema,
  ExportNetworkJsonInputSchema,
  ExportOxdnaBundleInputSchema,
  ExportOxViewJsonInputSchema,
  ExportSelectedBasesTextInputSchema,
  ExportSequencesCsvInputSchema,
  ExportUnfJsonInputSchema,
  FindElementsInputSchema,
  FillNetworkEdgesInputSchema,
  FocusElementInputSchema,
  FocusFilterInputSchema,
  FogInputSchema,
  ForceRemovalInputSchema,
  GetElementInfoInputSchema,
  GetSequenceFromElementsInputSchema,
  ImportForceTextInputSchema,
  InsertAfterInputSchema,
  InterconnectDuplexInputSchema,
  ListForcesInputSchema,
  LigateInputSchema,
  MoveElementsToInputSchema,
  NetworkIdInputSchema,
  NickInputSchema,
  PasteElementsInputSchema,
  RenameNamedSelectionInputSchema,
  RotateElementsInputSchema,
  RunDbscanInputSchema,
  SaveNamedSelectionInputSchema,
  SceneStateInputSchema,
  SceneSummaryInputSchema,
  SelectByPdbResiduesInputSchema,
  SelectElementsInputSchema,
  SelectEndsInputSchema,
  SelectionToClusterInputSchema,
  SetAxesVisibleInputSchema,
  SetBaseColorModeInputSchema,
  SetBoxVisibleInputSchema,
  SetCameraProjectionInputSchema,
  SetColoringModeInputSchema,
  SetComponentScaleInputSchema,
  SetComponentVisibilityInputSchema,
  SetElementVisibilityInputSchema,
  SetNetworkVisibilityInputSchema,
  SetRenderPresetInputSchema,
  SetSelectionModeInputSchema,
  SetSequenceInputSchema,
  SetStrandVisibilityInputSchema,
  SkipElementsInputSchema,
  StrandSequenceInputSchema,
  SystemHierarchyInputSchema,
  ThreePrimeMarkersInputSchema,
  TraceStrandInputSchema,
  TranslateElementsInputSchema,
} from "./schemas.js";

export type OxViewToolDefinition = {
  name: string;
  helperName: string;
  description: string;
  mutation: boolean;
  risk: ToolRisk;
  category: string;
  schema: z.ZodTypeAny;
  jsonSchema: Record<string, unknown>;
  tool: any;
};

type ToolConfig = {
  name: string;
  helperName: string;
  description: string;
  risk: ToolRisk;
  category: string;
  schema: z.ZodTypeAny;
  mutation?: boolean;
};

function withEnvelope(mutation: boolean, result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      mutation,
      ...(result as Record<string, unknown>),
    };
  }

  return {
    mutation,
    value: result,
  };
}

function toJsonSchema(name: string, schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema);
  if (jsonSchema && typeof jsonSchema === "object" && !Array.isArray(jsonSchema)) {
    return {
      additionalProperties: false,
      title: name,
      ...(jsonSchema as Record<string, unknown>),
    };
  }

  return {
    title: name,
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}

function buildDefinition(
  session: OxViewCDPSession,
  config: ToolConfig,
): OxViewToolDefinition {
  const mutation = config.mutation ?? config.risk !== "read";
  const jsonSchema = toJsonSchema(config.name, config.schema);

  return {
    ...config,
    mutation,
    jsonSchema,
    tool: tool(
      async (input) =>
        withEnvelope(mutation, await session.runHelper(config.helperName, input)),
      {
        name: config.name,
        description: config.description,
        schema: config.schema,
      },
    ),
  };
}

export function createOxViewTools(session: OxViewCDPSession) {
  const configs: ToolConfig[] = [
    {
      name: "get_scene_summary",
      helperName: "getSceneSummary",
      description:
        "Read the current oxView scene summary, including counts, selection, camera type, coloring mode, and recent API errors.",
      risk: "read",
      category: "query",
      schema: SceneSummaryInputSchema,
    },
    {
      name: "get_scene_state",
      helperName: "getSceneState",
      description:
        "Read a richer oxView scene state snapshot, including selection, camera, display toggles, component visibility, and clipboard state.",
      risk: "read",
      category: "query",
      schema: SceneStateInputSchema,
    },
    {
      name: "get_system_hierarchy",
      helperName: "getSystemHierarchy",
      description:
        "Read the system/strand hierarchy, optionally including capped monomer listings for each strand.",
      risk: "read",
      category: "query",
      schema: SystemHierarchyInputSchema,
    },
    {
      name: "get_api_errors",
      helperName: "getApiErrors",
      description: "Read the last oxView API error and recent API error history.",
      risk: "read",
      category: "query",
      schema: EmptyInputSchema,
    },
    {
      name: "find_elements",
      helperName: "findElements",
      description:
        "Resolve a typed filter into matching oxView element ids using ids, strand ids, system ids, cluster ids, selection membership, visibility, or base types.",
      risk: "read",
      category: "query",
      schema: FindElementsInputSchema,
    },
    {
      name: "get_element_info",
      helperName: "getElementInfo",
      description:
        "Read a serializable info object for one element id, including strand, pairing, positions, and orientation vectors.",
      risk: "read",
      category: "query",
      schema: GetElementInfoInputSchema,
    },
    {
      name: "get_distance",
      helperName: "getDistance",
      description:
        "Measure the distance between two elements using center, backbone, base, connector, or backboneConnector positions.",
      risk: "read",
      category: "query",
      schema: DistanceInputSchema,
    },
    {
      name: "get_center_of_mass",
      helperName: "getCenterOfMass",
      description:
        "Compute the center of mass for a filter of elements using a specific position target.",
      risk: "read",
      category: "query",
      schema: CenterOfMassInputSchema,
    },
    {
      name: "get_sequence_from_elements",
      helperName: "getSequenceFromElements",
      description:
        "Read the 5' to 3' sequence implied by an explicit list of element ids using oxView's strand-order rules.",
      risk: "read",
      category: "query",
      schema: GetSequenceFromElementsInputSchema,
    },
    {
      name: "get_strand_sequence",
      helperName: "getStrandSequence",
      description:
        "Read a strand sequence by strand id, or infer the strand from one element id.",
      risk: "read",
      category: "query",
      schema: StrandSequenceInputSchema,
    },
    {
      name: "trace_strand",
      helperName: "traceStrand",
      description:
        "Trace a strand from one element id toward 5' to 3' or 3' to 5' and return the visited element ids and sequence.",
      risk: "read",
      category: "query",
      schema: TraceStrandInputSchema,
    },
    {
      name: "count_strand_lengths",
      helperName: "countStrandLengths",
      description:
        "Summarize strand lengths for one system or the first loaded system.",
      risk: "read",
      category: "query",
      schema: CountStrandLengthsInputSchema,
    },
    {
      name: "list_forces",
      helperName: "listForces",
      description:
        "List the current force objects with stable force ids, descriptions, participants, and serialized oxDNA text.",
      risk: "read",
      category: "force",
      schema: ListForcesInputSchema,
    },
    {
      name: "list_networks",
      helperName: "listNetworks",
      description:
        "List the current networks with ids, particle membership, edge counts, cutoff, fitting state, and visibility.",
      risk: "read",
      category: "network",
      schema: EmptyInputSchema,
    },
    {
      name: "list_named_selections",
      helperName: "listNamedSelections",
      description:
        "List saved named selections with their names and element ids.",
      risk: "read",
      category: "selection",
      schema: EmptyInputSchema,
    },
    {
      name: "list_graph_datasets",
      helperName: "listGraphDatasets",
      description:
        "List loaded graph or fluctuation datasets with dataset ids, labels, datatypes, and sizes.",
      risk: "read",
      category: "query",
      schema: EmptyInputSchema,
    },
    {
      name: "select_elements",
      helperName: "selectElements",
      description:
        "Select elements matching a typed filter, replacing or extending the current selection.",
      risk: "mutating",
      category: "selection",
      schema: SelectElementsInputSchema,
    },
    {
      name: "clear_selection",
      helperName: "clearSelection",
      description: "Clear the current oxView selection.",
      risk: "mutating",
      category: "selection",
      schema: EmptyInputSchema,
    },
    {
      name: "select_ends",
      helperName: "selectEnds",
      description:
        "Select 5' or 3' strand ends for a set of strand ids or an entire system.",
      risk: "mutating",
      category: "selection",
      schema: SelectEndsInputSchema,
    },
    {
      name: "select_by_pdb_residues",
      helperName: "selectByPdbResidues",
      description:
        "Select amino-acid elements by residue number and optional chain id.",
      risk: "mutating",
      category: "selection",
      schema: SelectByPdbResiduesInputSchema,
    },
    {
      name: "set_selection_mode",
      helperName: "setSelectionMode",
      description:
        "Set the GUI selection mode explicitly and optionally set whether complementary pairs auto-select.",
      risk: "mutating",
      category: "selection",
      schema: SetSelectionModeInputSchema,
    },
    {
      name: "color_elements",
      helperName: "colorElements",
      description:
        "Color elements matching a typed filter using custom, base, or backbone coloring.",
      risk: "mutating",
      category: "view",
      schema: ColorElementsInputSchema,
    },
    {
      name: "reset_custom_coloring",
      helperName: "resetCustomColoring",
      description:
        "Reset custom coloring back to strand coloring and clear selection, matching the GUI reset behavior.",
      risk: "mutating",
      category: "view",
      schema: EmptyInputSchema,
    },
    {
      name: "set_coloring_mode",
      helperName: "setColoringMode",
      description:
        "Set the coloring mode to Strand, Cluster, System, Overlay, or Custom.",
      risk: "mutating",
      category: "view",
      schema: SetColoringModeInputSchema,
    },
    {
      name: "set_colorbar_visible",
      helperName: "setColorbarVisible",
      description: "Show or hide the overlay colorbar explicitly.",
      risk: "mutating",
      category: "view",
      schema: ColorbarVisibleInputSchema,
    },
    {
      name: "set_overlay_colormap",
      helperName: "setOverlayColormap",
      description: "Set the active overlay colormap by name.",
      risk: "mutating",
      category: "view",
      schema: ChangeColormapInputSchema,
    },
    {
      name: "set_overlay_bounds",
      helperName: "setOverlayBounds",
      description: "Set the numeric min/max bounds for the active overlay colormap.",
      risk: "mutating",
      category: "view",
      schema: ColorBoundsInputSchema,
    },
    {
      name: "create_helix_bundle",
      helperName: "createHelixBundle",
      description:
        "Create a new parallel bundle of DNA or RNA helices with random sequences, laid out on a hexagonal lattice near the current camera view.",
      risk: "destructive",
      category: "editing",
      schema: CreateHelixBundleInputSchema,
    },
    {
      name: "focus_element",
      helperName: "focusElement",
      description: "Move the camera toward a specific element id.",
      risk: "mutating",
      category: "view",
      schema: FocusElementInputSchema,
    },
    {
      name: "focus_filter",
      helperName: "focusFilter",
      description:
        "Focus the camera on the center of mass of a filtered element set.",
      risk: "mutating",
      category: "view",
      schema: FocusFilterInputSchema,
    },
    {
      name: "set_element_visibility",
      helperName: "setElementVisibility",
      description:
        "Set visibility explicitly for elements matching a filter instead of toggling blindly.",
      risk: "mutating",
      category: "view",
      schema: SetElementVisibilityInputSchema,
    },
    {
      name: "set_strand_visibility",
      helperName: "setStrandVisibility",
      description:
        "Set visibility explicitly for a list of strand ids.",
      risk: "mutating",
      category: "view",
      schema: SetStrandVisibilityInputSchema,
    },
    {
      name: "restore_hidden_elements",
      helperName: "restoreHiddenElements",
      description: "Make every currently hidden element visible again.",
      risk: "mutating",
      category: "view",
      schema: EmptyInputSchema,
    },
    {
      name: "set_component_visibility",
      helperName: "setComponentVisibility",
      description:
        "Show or hide a whole geometric component family such as backbone, nucleoside, connector, or bbconnector.",
      risk: "mutating",
      category: "view",
      schema: SetComponentVisibilityInputSchema,
    },
    {
      name: "set_component_scale",
      helperName: "setComponentScale",
      description:
        "Set the global scale of a geometric component family such as backbone, nucleoside, connector, or bbconnector.",
      risk: "mutating",
      category: "view",
      schema: SetComponentScaleInputSchema,
    },
    {
      name: "set_base_color_mode",
      helperName: "setBaseColorMode",
      description:
        "Set nucleoside base colors to the default type colors or to gray.",
      risk: "mutating",
      category: "view",
      schema: SetBaseColorModeInputSchema,
    },
    {
      name: "set_render_preset",
      helperName: "setRenderPreset",
      description:
        "Apply a render preset such as default or sugar-phosphate only.",
      risk: "mutating",
      category: "view",
      schema: SetRenderPresetInputSchema,
    },
    {
      name: "set_camera_projection",
      helperName: "setCameraProjection",
      description:
        "Set the camera projection explicitly to perspective or orthographic.",
      risk: "mutating",
      category: "view",
      schema: SetCameraProjectionInputSchema,
    },
    {
      name: "set_background_color",
      helperName: "setBackgroundColor",
      description: "Set the canvas background color.",
      risk: "mutating",
      category: "view",
      schema: BackgroundColorInputSchema,
    },
    {
      name: "set_axes_visible",
      helperName: "setAxesVisible",
      description: "Show or hide the coordinate axes.",
      risk: "mutating",
      category: "view",
      schema: SetAxesVisibleInputSchema,
    },
    {
      name: "set_box_visible",
      helperName: "setBoxVisible",
      description: "Show or hide the simulation box.",
      risk: "mutating",
      category: "view",
      schema: SetBoxVisibleInputSchema,
    },
    {
      name: "set_fog",
      helperName: "setFog",
      description:
        "Enable or disable fog, optionally setting explicit near and far distances.",
      risk: "mutating",
      category: "view",
      schema: FogInputSchema,
    },
    {
      name: "set_3prime_markers",
      helperName: "set3PrimeMarkers",
      description:
        "Enable or disable 3' end markers, optionally setting diameter, length, and spacing.",
      risk: "mutating",
      category: "view",
      schema: ThreePrimeMarkersInputSchema,
    },
    {
      name: "translate_elements",
      helperName: "translateElements",
      description:
        "Translate all elements matching a filter by a 3D vector and record the move in undo history.",
      risk: "mutating",
      category: "transform",
      schema: TranslateElementsInputSchema,
    },
    {
      name: "rotate_elements",
      helperName: "rotateElements",
      description:
        "Rotate all elements matching a filter around an axis by a number of degrees and record the move in undo history.",
      risk: "mutating",
      category: "transform",
      schema: RotateElementsInputSchema,
    },
    {
      name: "move_elements_to",
      helperName: "moveElementsTo",
      description:
        "Translate an explicit element list so one anchor element moves onto a target element.",
      risk: "mutating",
      category: "transform",
      schema: MoveElementsToInputSchema,
    },
    {
      name: "toggle_visibility",
      helperName: "toggleVisibility",
      description:
        "Toggle visibility for elements matching a typed filter. Prefer set_element_visibility when you need an explicit final state.",
      risk: "mutating",
      category: "view",
      schema: FindElementsInputSchema,
    },
    {
      name: "show_everything",
      helperName: "showEverything",
      description:
        "Restore the default scene scaling so all oxView geometry becomes visible again.",
      risk: "mutating",
      category: "view",
      schema: EmptyInputSchema,
    },
    {
      name: "toggle_base_colors",
      helperName: "toggleBaseColors",
      description:
        "Toggle nucleoside colors between type-based colors and gray. Prefer set_base_color_mode for idempotent behavior.",
      risk: "mutating",
      category: "view",
      schema: EmptyInputSchema,
    },
    {
      name: "switch_camera",
      helperName: "switchCamera",
      description:
        "Toggle the camera projection between perspective and orthographic. Prefer set_camera_projection for idempotent behavior.",
      risk: "mutating",
      category: "view",
      schema: EmptyInputSchema,
    },
    {
      name: "create_strand",
      helperName: "createStrand",
      description:
        "Create a new DNA or RNA strand from a sequence or random requested length by filling oxView's Create controls and invoking createWrapper(), optionally as a duplex.",
      risk: "destructive",
      category: "editing",
      schema: CreateStrandInputSchema,
    },
    {
      name: "extend_strand",
      helperName: "extendStrand",
      description:
        "Extend an open strand end from an explicit element id using a sequence and register the addition in undo history.",
      risk: "destructive",
      category: "editing",
      schema: ExtendStrandInputSchema,
    },
    {
      name: "extend_duplex",
      helperName: "extendDuplex",
      description:
        "Extend a duplex from an explicit nucleotide id using either GUI semantics or raw oxView duplex semantics.",
      risk: "destructive",
      category: "editing",
      schema: ExtendDuplexInputSchema,
    },
    {
      name: "insert_after",
      helperName: "insertAfter",
      description:
        "Insert a sequence after one element inside a strand, matching oxView's insert behavior.",
      risk: "destructive",
      category: "editing",
      schema: InsertAfterInputSchema,
    },
    {
      name: "skip_elements",
      helperName: "skipElements",
      description:
        "Delete elements and auto-ligate their neighbors when possible, matching oxView's skip behavior.",
      risk: "destructive",
      category: "editing",
      schema: SkipElementsInputSchema,
    },
    {
      name: "delete_elements",
      helperName: "deleteElements",
      description:
        "Delete a set of explicit element ids and record the deletion in undo history.",
      risk: "destructive",
      category: "editing",
      schema: DeleteElementsInputSchema,
    },
    {
      name: "nick",
      helperName: "nick",
      description: "Nick a strand at one element id and record the change in undo history.",
      risk: "destructive",
      category: "editing",
      schema: NickInputSchema,
    },
    {
      name: "ligate",
      helperName: "ligate",
      description:
        "Ligate two compatible strand ends and record the change in undo history.",
      risk: "destructive",
      category: "editing",
      schema: LigateInputSchema,
    },
    {
      name: "set_sequence",
      helperName: "setSequence",
      description:
        "Set the sequence for an explicit element list, optionally updating complementary bases, and record the change in undo history.",
      risk: "destructive",
      category: "editing",
      schema: SetSequenceInputSchema,
    },
    {
      name: "create_base_pair",
      helperName: "createBasePair",
      description:
        "Create a complementary base pair for a nucleotide that does not already have one.",
      risk: "destructive",
      category: "editing",
      schema: CreateBasePairInputSchema,
    },
    {
      name: "interconnect_duplex",
      helperName: "interconnectDuplex",
      description:
        "Connect two strand ends by building a duplex patch between them.",
      risk: "destructive",
      category: "editing",
      schema: InterconnectDuplexInputSchema,
    },
    {
      name: "create_mutual_traps",
      helperName: "createMutualTraps",
      description:
        "Create one or two mutual traps for each explicit particle pair, matching the forces GUI but without relying on the current selection.",
      risk: "mutating",
      category: "force",
      schema: CreateMutualTrapsInputSchema,
    },
    {
      name: "create_pair_traps_from_basepairs",
      helperName: "createPairTrapsFromBasepairs",
      description:
        "Create mutual traps from existing basepair relationships for a filtered element set.",
      risk: "mutating",
      category: "force",
      schema: CreatePairTrapsFromBasepairsInputSchema,
    },
    {
      name: "create_sphere_force",
      helperName: "createSphereForce",
      description:
        "Create a repulsive sphere force for explicit particles or for all particles if no particle ids are provided.",
      risk: "mutating",
      category: "force",
      schema: CreateSphereForceInputSchema,
    },
    {
      name: "remove_forces",
      helperName: "removeForces",
      description:
        "Remove forces by force ids, by participating element ids, or all at once. This is not integrated with undo.",
      risk: "destructive",
      category: "force",
      schema: ForceRemovalInputSchema,
    },
    {
      name: "import_force_text",
      helperName: "importForceText",
      description:
        "Import oxDNA-style force text and append or replace the current force list.",
      risk: "destructive",
      category: "force",
      schema: ImportForceTextInputSchema,
    },
    {
      name: "export_force_text",
      helperName: "exportForceText",
      description:
        "Export the current forces as oxDNA force text, optionally remapped to freshly generated oxDNA ids.",
      risk: "read",
      category: "export",
      schema: ExportForceTextInputSchema,
    },
    {
      name: "create_network",
      helperName: "createNetwork",
      description:
        "Create a new network from an explicit element list and register the creation in undo history.",
      risk: "mutating",
      category: "network",
      schema: CreateNetworkInputSchema,
    },
    {
      name: "delete_network",
      helperName: "deleteNetwork",
      description:
        "Delete one existing network and remove its GUI state. This is not integrated with undo.",
      risk: "destructive",
      category: "network",
      schema: NetworkIdInputSchema,
    },
    {
      name: "select_network",
      helperName: "selectNetwork",
      description:
        "Select all elements that belong to one network and make it the active network.",
      risk: "mutating",
      category: "network",
      schema: NetworkIdInputSchema,
    },
    {
      name: "set_network_visibility",
      helperName: "setNetworkVisibility",
      description:
        "Show or hide one network explicitly instead of toggling it blindly.",
      risk: "mutating",
      category: "network",
      schema: SetNetworkVisibilityInputSchema,
    },
    {
      name: "copy_network",
      helperName: "copyNetwork",
      description:
        "Copy one network's edge layout onto a new explicit element set, using a deep edge copy instead of the GUI's shared-reference behavior.",
      risk: "mutating",
      category: "network",
      schema: CopyNetworkInputSchema,
    },
    {
      name: "fill_network_edges",
      helperName: "fillNetworkEdges",
      description:
        "Populate one network's edges using ANM, MWCENM, or ANMT logic.",
      risk: "mutating",
      category: "network",
      schema: FillNetworkEdgesInputSchema,
    },
    {
      name: "clear_clusters",
      helperName: "clearClusters",
      description:
        "Clear all cluster ids and restore strand coloring.",
      risk: "mutating",
      category: "clustering",
      schema: EmptyInputSchema,
    },
    {
      name: "run_dbscan",
      helperName: "runDbscan",
      description:
        "Run DBSCAN clustering with explicit parameters and switch coloring to Cluster mode.",
      risk: "mutating",
      category: "clustering",
      schema: RunDbscanInputSchema,
    },
    {
      name: "selection_to_cluster",
      helperName: "selectionToCluster",
      description:
        "Assign an explicit element list to a new cluster id and switch coloring to Cluster mode.",
      risk: "mutating",
      category: "clustering",
      schema: SelectionToClusterInputSchema,
    },
    {
      name: "save_named_selection",
      helperName: "saveNamedSelection",
      description:
        "Save a named selection from explicit element ids or from the current selection.",
      risk: "mutating",
      category: "selection",
      schema: SaveNamedSelectionInputSchema,
    },
    {
      name: "apply_named_selection",
      helperName: "applyNamedSelection",
      description:
        "Apply one saved named selection by replacing or extending the current selection.",
      risk: "mutating",
      category: "selection",
      schema: ApplyNamedSelectionInputSchema,
    },
    {
      name: "delete_named_selection",
      helperName: "deleteNamedSelection",
      description:
        "Delete one saved named selection.",
      risk: "mutating",
      category: "selection",
      schema: DeleteNamedSelectionInputSchema,
    },
    {
      name: "rename_named_selection",
      helperName: "renameNamedSelection",
      description:
        "Rename one saved named selection.",
      risk: "mutating",
      category: "selection",
      schema: RenameNamedSelectionInputSchema,
    },
    {
      name: "export_oxdna_bundle",
      helperName: "exportOxdnaBundle",
      description:
        "Generate virtual oxDNA output files including topology, configuration, par, masses, and force text without triggering browser downloads.",
      risk: "read",
      category: "export",
      schema: ExportOxdnaBundleInputSchema,
    },
    {
      name: "export_oxview_json",
      helperName: "exportOxViewJson",
      description:
        "Serialize the current scene to oxView JSON without triggering a browser download.",
      risk: "read",
      category: "export",
      schema: ExportOxViewJsonInputSchema,
    },
    {
      name: "export_sequences_csv",
      helperName: "exportSequencesCsv",
      description:
        "Export strand sequences as CSV for explicit elements or for the whole scene.",
      risk: "read",
      category: "export",
      schema: ExportSequencesCsvInputSchema,
    },
    {
      name: "export_selected_bases_text",
      helperName: "exportSelectedBasesText",
      description:
        "Export explicit or currently selected element ids as a plain-text file payload.",
      risk: "read",
      category: "export",
      schema: ExportSelectedBasesTextInputSchema,
    },
    {
      name: "export_index_text",
      helperName: "exportIndexText",
      description:
        "Export index groups as plain text without triggering a browser download.",
      risk: "read",
      category: "export",
      schema: ExportIndexTextInputSchema,
    },
    {
      name: "export_network_json",
      helperName: "exportNetworkJson",
      description:
        "Export one network's JSON payload. This matches the GUI export and does not include explicit edge data.",
      risk: "read",
      category: "export",
      schema: ExportNetworkJsonInputSchema,
    },
    {
      name: "export_fluctuation_json",
      helperName: "exportFluctuationJson",
      description:
        "Export one graph dataset as fluctuation JSON. This currently changes the flux view's type and units as a side effect.",
      risk: "mutating",
      category: "export",
      schema: ExportFluctuationJsonInputSchema,
    },
    {
      name: "export_unf_json",
      helperName: "exportUnfJson",
      description:
        "Export the current scene as UNF JSON and return it as a virtual file payload.",
      risk: "read",
      category: "export",
      schema: ExportUnfJsonInputSchema,
    },
    {
      name: "export_camera_state",
      helperName: "exportCameraState",
      description:
        "Export the current camera state as JSON without triggering a browser download.",
      risk: "read",
      category: "export",
      schema: ExportCameraStateInputSchema,
    },
    {
      name: "copy_elements",
      helperName: "copyElements",
      description:
        "Copy an explicit element list into the LangGraph clipboard state without changing the scene.",
      risk: "mutating",
      category: "clipboard",
      schema: CopyElementsInputSchema,
      mutation: false,
    },
    {
      name: "cut_elements",
      helperName: "cutElements",
      description:
        "Copy an explicit element list into the LangGraph clipboard state and delete the originals.",
      risk: "destructive",
      category: "clipboard",
      schema: CopyElementsInputSchema,
    },
    {
      name: "paste_elements",
      helperName: "pasteElements",
      description:
        "Paste the current LangGraph clipboard contents at the original positions, at a provided position, or in front of the camera.",
      risk: "destructive",
      category: "clipboard",
      schema: PasteElementsInputSchema,
    },
    {
      name: "undo",
      helperName: "undo",
      description: "Undo the most recent oxView edit or scene action.",
      risk: "mutating",
      category: "history",
      schema: EmptyInputSchema,
    },
    {
      name: "redo",
      helperName: "redo",
      description: "Redo the most recently undone oxView edit or scene action.",
      risk: "mutating",
      category: "history",
      schema: EmptyInputSchema,
    },
  ];

  const definitions = configs.map((config) => buildDefinition(session, config));
  const toolMap = new Map(definitions.map((definition) => [definition.name, definition]));

  return {
    definitions,
    tools: definitions.map((definition) => definition.tool),
    toolMap,
    availableTools: definitions.map<AvailableToolMetadata>((definition) => ({
      name: definition.name,
      description: definition.description,
      risk: definition.risk,
      category: definition.category,
      jsonSchema: definition.jsonSchema,
    })),
  };
}
