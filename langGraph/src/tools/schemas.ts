import { z } from "zod";

const NonNegativeIntSchema = z.number().int().nonnegative();
const PositiveIntSchema = z.number().int().positive();

export const ExecutionModeSchema = z.enum([
  "safe-auto",
  "always-preview",
  "always-execute",
]);

export const ToolRiskSchema = z.enum(["read", "mutating", "destructive"]);

export const ElementKindSchema = z.enum([
  "nucleotide",
  "aminoAcid",
  "genericSphere",
]);

export const PositionTargetSchema = z.enum([
  "center",
  "backbone",
  "base",
  "connector",
  "backboneConnector",
]);

export const ComponentSchema = z.enum([
  "backbone",
  "nucleoside",
  "connector",
  "bbconnector",
]);

export const ColoringModeSchema = z.enum([
  "Strand",
  "Cluster",
  "System",
  "Overlay",
  "Custom",
]);

export const CameraProjectionSchema = z.enum([
  "perspective",
  "orthographic",
]);

export const PolymerTypeSchema = z.enum(["DNA", "RNA"]);

export const RenderPresetSchema = z.enum(["default", "spOnly"]);

export const DuplexEndSchema = z.enum(["3p", "5p"]);

export const SelectionModeSchema = z.enum([
  "Monomer",
  "Strand",
  "System",
  "Cluster",
  "Box",
  "Disabled",
]);

export const AttributePredicateSchema = z.object({
  field: z.enum(["type", "label", "clusterId", "strandId", "systemId"]),
  operator: z.enum(["eq", "neq", "contains", "gt", "lt"]),
  value: z.union([z.string(), z.number()]),
});

export const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const ElementIdSchema = NonNegativeIntSchema;
export const StrandIdSchema = NonNegativeIntSchema;
export const SystemIdSchema = NonNegativeIntSchema;
export const NetworkIdSchema = NonNegativeIntSchema;
export const DatasetIdSchema = NonNegativeIntSchema;

export const ElementFilterSchema = z
  .object({
    ids: z.array(ElementIdSchema).optional(),
    parity: z.enum(["odd", "even"]).optional(),
    strandIds: z.array(StrandIdSchema).optional(),
    systemIds: z.array(SystemIdSchema).optional(),
    clusterIds: z.array(z.number().int()).optional(),
    baseTypes: z.array(z.string().min(1)).optional(),
    selectedOnly: z.boolean().optional(),
    pairedOnly: z.boolean().optional(),
    visibleOnly: z.boolean().optional(),
    elementKinds: z.array(ElementKindSchema).optional(),
    attributePredicate: AttributePredicateSchema.optional(),
    limit: PositiveIntSchema.optional(),
  })
  .default({});

export const SceneSummaryInputSchema = z.object({
  includeSelection: z.boolean().default(true),
});

export const SceneStateInputSchema = z.object({
  includeSelection: z.boolean().default(true),
  includeDisplay: z.boolean().default(true),
  includeCamera: z.boolean().default(true),
});

export const FindElementsInputSchema = z.object({
  filter: ElementFilterSchema,
});

export const SystemHierarchyInputSchema = z.object({
  includeMonomers: z.boolean().default(false),
  maxMonomersPerStrand: PositiveIntSchema.optional(),
});

export const GetElementInfoInputSchema = z.object({
  elementId: ElementIdSchema,
});

export const DistanceInputSchema = z.object({
  firstElementId: ElementIdSchema,
  secondElementId: ElementIdSchema,
  target: PositionTargetSchema.default("center"),
});

export const CenterOfMassInputSchema = z.object({
  filter: ElementFilterSchema,
  target: PositionTargetSchema.default("center"),
});

export const GetSequenceFromElementsInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1),
});

export const StrandSequenceInputSchema = z
  .object({
    strandId: StrandIdSchema.optional(),
    elementId: ElementIdSchema.optional(),
  })
  .refine((value) => value.strandId !== undefined || value.elementId !== undefined, {
    message: "Provide strandId or elementId.",
  });

export const TraceStrandInputSchema = z.object({
  elementId: ElementIdSchema,
  direction: z.enum(["5to3", "3to5"]).default("5to3"),
});

export const CountStrandLengthsInputSchema = z.object({
  systemId: SystemIdSchema.optional(),
});

export const SelectElementsInputSchema = z.object({
  filter: ElementFilterSchema,
  mode: z.enum(["replace", "add"]).default("replace"),
});

export const SelectEndsInputSchema = z.object({
  which: z.enum(["5p", "3p"]),
  systemId: SystemIdSchema.optional(),
  strandIds: z.array(StrandIdSchema).min(1).optional(),
  mode: z.enum(["replace", "add"]).default("replace"),
});

export const SelectByPdbResiduesInputSchema = z.object({
  residues: z
    .array(
      z.object({
        residueNumber: z.number().int(),
        chainId: z.string().min(1).optional(),
      }),
    )
    .min(1),
  mode: z.enum(["replace", "add"]).default("replace"),
});

export const SetSelectionModeInputSchema = z.object({
  mode: SelectionModeSchema,
  selectPairs: z.boolean().optional(),
});

export const ColorElementsInputSchema = z.object({
  filter: ElementFilterSchema,
  color: z.string().min(1),
  applyTo: z.enum(["custom", "base", "backbone"]).default("custom"),
});

export const SetColoringModeInputSchema = z.object({
  mode: ColoringModeSchema,
});

export const ColorbarVisibleInputSchema = z.object({
  visible: z.boolean(),
});

export const ChangeColormapInputSchema = z.object({
  name: z.string().min(1),
});

export const ColorBoundsInputSchema = z.object({
  min: z.number(),
  max: z.number(),
});

export const SetComponentVisibilityInputSchema = z.object({
  component: ComponentSchema,
  visible: z.boolean(),
});

export const SetComponentScaleInputSchema = z.object({
  component: ComponentSchema,
  scale: z.number().positive(),
});

export const SetElementVisibilityInputSchema = z.object({
  filter: ElementFilterSchema,
  visible: z.boolean(),
});

export const SetStrandVisibilityInputSchema = z.object({
  strandIds: z.array(StrandIdSchema).min(1),
  visible: z.boolean(),
});

export const SetBaseColorModeInputSchema = z.object({
  mode: z.enum(["default", "gray"]),
});

export const SetRenderPresetInputSchema = z.object({
  preset: RenderPresetSchema,
});

export const CreateHelixBundleInputSchema = z.object({
  numberOfHelices: z.number().int().positive().default(6),
  basePairsPerHelix: z.number().int().positive().default(32),
  nucleicAcidType: z.enum(["DNA", "RNA"]).default("DNA"),
  duplex: z.boolean().default(true),
  spacing: z.number().positive().default(4),
  randomizeHelixPhase: z.boolean().default(true),
  focusAfterCreate: z.boolean().default(true),
  labelPrefix: z.string().min(1).default("bundle"),
});

export const FocusElementInputSchema = z.object({
  elementId: ElementIdSchema,
  steps: PositiveIntSchema.default(20),
});

export const FocusFilterInputSchema = z.object({
  filter: ElementFilterSchema,
  target: PositionTargetSchema.default("center"),
  distance: z.number().positive().default(10),
});

export const SetCameraProjectionInputSchema = z.object({
  projection: CameraProjectionSchema,
});

export const BackgroundColorInputSchema = z.object({
  color: z.string().min(1),
});

export const SetAxesVisibleInputSchema = z.object({
  visible: z.boolean(),
});

export const SetBoxVisibleInputSchema = z.object({
  visible: z.boolean(),
});

export const FogInputSchema = z.object({
  enabled: z.boolean(),
  near: z.number().nonnegative().optional(),
  far: z.number().nonnegative().optional(),
});

export const ThreePrimeMarkersInputSchema = z.object({
  enabled: z.boolean(),
  diameter: z.number().positive().default(5),
  length: z.number().positive().default(1),
  spacing: z.number().nonnegative().default(0.25),
});

export const TranslateElementsInputSchema = z.object({
  filter: ElementFilterSchema,
  vector: Vector3Schema,
});

export const RotateElementsInputSchema = z.object({
  filter: ElementFilterSchema,
  axis: Vector3Schema,
  angleDegrees: z.number(),
  about: Vector3Schema.optional(),
});

export const MoveElementsToInputSchema = z.object({
  targetElementId: ElementIdSchema,
  elementIds: z.array(ElementIdSchema).min(1),
  anchorElementId: ElementIdSchema.optional(),
});

export const CreateStrandInputSchema = z
  .object({
    sequence: z.string().min(1).optional(),
    length: PositiveIntSchema.optional(),
    duplex: z.boolean().default(false),
    polymerType: PolymerTypeSchema.default("DNA"),
    focusAfterCreate: z.boolean().default(true),
  })
  .refine((value) => value.sequence !== undefined || value.length !== undefined, {
    message: "Provide either sequence or length.",
  });

export const ExtendStrandInputSchema = z.object({
  endElementId: ElementIdSchema,
  sequence: z.string().min(1),
});

export const ExtendDuplexInputSchema = z.object({
  endElementId: ElementIdSchema,
  sequence: z.string().min(1),
  semantics: z.enum(["gui", "raw"]).default("gui"),
});

export const InsertAfterInputSchema = z.object({
  elementId: ElementIdSchema,
  sequence: z.string().min(1),
});

export const DeleteElementsInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1),
});

export const SkipElementsInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1),
});

export const NickInputSchema = z.object({
  elementId: ElementIdSchema,
});

export const LigateInputSchema = z.object({
  firstElementId: ElementIdSchema,
  secondElementId: ElementIdSchema,
});

export const SetSequenceInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1),
  sequence: z.string().min(1),
  updateComplement: z.boolean().default(false),
});

export const CreateBasePairInputSchema = z.object({
  elementId: ElementIdSchema,
});

export const InterconnectDuplexInputSchema = z.object({
  strandId1: StrandIdSchema,
  strandId2: StrandIdSchema,
  patchSequence: z.string().min(1),
  end: DuplexEndSchema,
});

export const CopyElementsInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1),
});

export const PasteElementsInputSchema = z.object({
  keepOriginalPosition: z.boolean().default(false),
  position: Vector3Schema.optional(),
});

export const NetworkEdgeModeSchema = z.enum(["ANM", "MWCENM", "ANMT"]);

export const ListForcesInputSchema = z.object({
  type: z.string().min(1).optional(),
  limit: PositiveIntSchema.optional(),
});

export const ForceRemovalInputSchema = z
  .object({
    indices: z.array(NonNegativeIntSchema).optional(),
    elementIds: z.array(ElementIdSchema).optional(),
    removePair: z.boolean().default(false),
    all: z.boolean().default(false),
  })
  .refine(
    (value) => value.all || (value.indices?.length ?? 0) > 0 || (value.elementIds?.length ?? 0) > 0,
    {
      message: "Provide indices, elementIds, or all=true.",
    },
  );

export const CreateMutualTrapsInputSchema = z.object({
  pairs: z
    .array(
      z.object({
        particleId: ElementIdSchema,
        refParticleId: ElementIdSchema,
      }),
    )
    .min(1),
  stiff: z.number().default(0.09),
  r0: z.number().default(1.2),
  PBC: z.number().default(1),
  bidirectional: z.boolean().default(false),
});

export const CreatePairTrapsFromBasepairsInputSchema = z.object({
  filter: ElementFilterSchema.default({}),
  stiff: z.number().default(0.09),
});

export const CreateSphereForceInputSchema = z.object({
  particleIds: z.array(ElementIdSchema).optional(),
  stiff: z.number().default(0.09),
  r0: z.number().default(1.2),
  rate: z.number().default(0),
  center: Vector3Schema.optional(),
});

export const ImportForceTextInputSchema = z.object({
  text: z.string().min(1),
  replaceExisting: z.boolean().default(false),
});

export const ExportForceTextInputSchema = z.object({
  remapToOxdnaIds: z.boolean().default(false),
  topologyFormat: z.enum(["new", "old"]).default("new"),
  filename: z.string().min(1).default("forces.txt"),
});

export const CreateNetworkInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1),
});

export const NetworkIdInputSchema = z.object({
  networkId: NetworkIdSchema,
});

export const SetNetworkVisibilityInputSchema = z.object({
  networkId: NetworkIdSchema,
  visible: z.boolean(),
});

export const CopyNetworkInputSchema = z.object({
  sourceNetworkId: NetworkIdSchema,
  targetElementIds: z.array(ElementIdSchema).min(1),
});

export const FillNetworkEdgesInputSchema = z.object({
  networkId: NetworkIdSchema,
  mode: NetworkEdgeModeSchema,
  cutoffAngstroms: z.number().positive().optional(),
});

export const RunDbscanInputSchema = z.object({
  minPts: z.number().positive(),
  epsilon: z.number().positive(),
});

export const SelectionToClusterInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1),
});

export const SaveNamedSelectionInputSchema = z.object({
  name: z.string().min(1),
  elementIds: z.array(ElementIdSchema).min(1).optional(),
});

export const ApplyNamedSelectionInputSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(["replace", "add"]).default("replace"),
});

export const DeleteNamedSelectionInputSchema = z.object({
  name: z.string().min(1),
});

export const RenameNamedSelectionInputSchema = z.object({
  oldName: z.string().min(1),
  newName: z.string().min(1),
});

export const ExportOxdnaBundleInputSchema = z.object({
  name: z.string().min(1).default("output"),
  topologyFormat: z.enum(["new", "old"]).default("new"),
  includeTop: z.boolean().default(true),
  includeDat: z.boolean().default(true),
  includePar: z.boolean().default(true),
  includeMass: z.boolean().default(true),
  includeForces: z.boolean().default(true),
});

export const ExportOxViewJsonInputSchema = z.object({
  name: z.string().min(1).default("output"),
  pretty: z.boolean().default(true),
});

export const ExportSequencesCsvInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1).optional(),
});

export const ExportSelectedBasesTextInputSchema = z.object({
  elementIds: z.array(ElementIdSchema).min(1).optional(),
});

export const ExportIndexTextInputSchema = z.object({
  groups: z.array(z.array(ElementIdSchema)).min(1),
  filename: z.string().min(1).default("index.txt"),
});

export const ExportNetworkJsonInputSchema = z.object({
  networkId: NetworkIdSchema,
});

export const ExportFluctuationJsonInputSchema = z.object({
  datasetId: DatasetIdSchema,
});

export const ExportUnfJsonInputSchema = z.object({
  name: z.string().min(1).default("output"),
});

export const ExportCameraStateInputSchema = z.object({
  filename: z.string().min(1).default("camera.json"),
});

export const EmptyInputSchema = z.object({});

export const RequestClassificationSchema = z.object({
  requestKind: z.enum(["read", "mutating", "destructive", "ambiguous"]),
  requiresConfirmation: z.boolean(),
  requiresClarification: z.boolean(),
  explanation: z.string(),
  clarificationQuestion: z.string().nullable().optional(),
});

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
export type ElementFilter = z.infer<typeof ElementFilterSchema>;
export type RequestClassification = z.infer<typeof RequestClassificationSchema>;
export type ToolRisk = z.infer<typeof ToolRiskSchema>;
