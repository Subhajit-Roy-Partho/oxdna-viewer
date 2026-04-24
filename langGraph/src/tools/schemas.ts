import { z } from "zod";

export const ExecutionModeSchema = z.enum([
  "safe-auto",
  "always-preview",
  "always-execute",
]);

export const ElementKindSchema = z.enum([
  "nucleotide",
  "aminoAcid",
  "genericSphere",
]);

export const AttributePredicateSchema = z.object({
  field: z.enum(["type", "label", "clusterId", "strandId", "systemId"]),
  operator: z.enum(["eq", "neq", "contains", "gt", "lt"]),
  value: z.union([z.string(), z.number()]),
});

export const ElementFilterSchema = z
  .object({
    ids: z.array(z.number().int().nonnegative()).optional(),
    parity: z.enum(["odd", "even"]).optional(),
    strandIds: z.array(z.number().int()).optional(),
    baseTypes: z.array(z.string().min(1)).optional(),
    selectedOnly: z.boolean().optional(),
    elementKinds: z.array(ElementKindSchema).optional(),
    attributePredicate: AttributePredicateSchema.optional(),
    limit: z.number().int().positive().optional(),
  })
  .default({});

export const SceneSummaryInputSchema = z.object({
  includeSelection: z.boolean().default(true),
});

export const FindElementsInputSchema = z.object({
  filter: ElementFilterSchema,
});

export const GetElementInfoInputSchema = z.object({
  elementId: z.number().int().nonnegative(),
});

export const DistanceInputSchema = z.object({
  firstElementId: z.number().int().nonnegative(),
  secondElementId: z.number().int().nonnegative(),
  target: z
    .enum(["center", "backbone", "base", "connector", "backboneConnector"])
    .default("center"),
});

export const CenterOfMassInputSchema = z.object({
  filter: ElementFilterSchema,
  target: z
    .enum(["center", "backbone", "base", "connector", "backboneConnector"])
    .default("center"),
});

export const SelectElementsInputSchema = z.object({
  filter: ElementFilterSchema,
  mode: z.enum(["replace", "add"]).default("replace"),
});

export const ColorElementsInputSchema = z.object({
  filter: ElementFilterSchema,
  color: z.string().min(1),
  applyTo: z.enum(["custom", "base", "backbone"]).default("custom"),
});

export const ToggleVisibilityInputSchema = z.object({
  filter: ElementFilterSchema,
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
  elementId: z.number().int().nonnegative(),
  steps: z.number().int().positive().default(20),
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
