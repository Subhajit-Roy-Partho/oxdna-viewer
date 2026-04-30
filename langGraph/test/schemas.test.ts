import test from "node:test";
import assert from "node:assert/strict";
import {
  ColorElementsInputSchema,
  CreateStrandInputSchema,
  ElementFilterSchema,
  ExportOxdnaBundleInputSchema,
  ForceRemovalInputSchema,
  RequestClassificationSchema,
  SaveNamedSelectionInputSchema,
  SetSelectionModeInputSchema,
} from "../src/tools/schemas.js";

test("ElementFilterSchema accepts parity and base types", () => {
  const parsed = ElementFilterSchema.parse({
    parity: "odd",
    baseTypes: ["A", "T"],
    elementKinds: ["nucleotide"],
  });

  assert.equal(parsed.parity, "odd");
  assert.deepEqual(parsed.baseTypes, ["A", "T"]);
});

test("ColorElementsInputSchema requires a color and filter", () => {
  const parsed = ColorElementsInputSchema.parse({
    filter: { ids: [1, 3, 5] },
    color: "#00ff00",
    applyTo: "custom",
  });

  assert.deepEqual(parsed.filter.ids, [1, 3, 5]);
  assert.equal(parsed.color, "#00ff00");
});

test("RequestClassificationSchema validates clarification records", () => {
  const parsed = RequestClassificationSchema.parse({
    requestKind: "ambiguous",
    requiresConfirmation: false,
    requiresClarification: true,
    explanation: "Numbered nucleotide target is ambiguous.",
    clarificationQuestion: "Do you mean element id 13 or base type 13?",
  });

  assert.equal(parsed.requestKind, "ambiguous");
  assert.equal(parsed.requiresClarification, true);
});

test("CreateStrandInputSchema accepts duplex DNA creation", () => {
  const parsed = CreateStrandInputSchema.parse({
    sequence: "ACGTACGT",
    duplex: true,
    polymerType: "DNA",
  });

  assert.equal(parsed.sequence, "ACGTACGT");
  assert.equal(parsed.duplex, true);
  assert.equal(parsed.polymerType, "DNA");
});

test("CreateStrandInputSchema accepts length-based duplex DNA creation", () => {
  const parsed = CreateStrandInputSchema.parse({
    length: 20,
    duplex: true,
    polymerType: "DNA",
  });

  assert.equal(parsed.length, 20);
  assert.equal(parsed.duplex, true);
  assert.equal(parsed.polymerType, "DNA");
  assert.equal(parsed.focusAfterCreate, true);
});

test("SetSelectionModeInputSchema validates explicit selection mode changes", () => {
  const parsed = SetSelectionModeInputSchema.parse({
    mode: "Strand",
    selectPairs: true,
  });

  assert.equal(parsed.mode, "Strand");
  assert.equal(parsed.selectPairs, true);
});

test("ForceRemovalInputSchema accepts indexed or targeted removals", () => {
  const parsed = ForceRemovalInputSchema.parse({
    indices: [0, 2],
    removePair: true,
  });

  assert.deepEqual(parsed.indices, [0, 2]);
  assert.equal(parsed.removePair, true);
});

test("SaveNamedSelectionInputSchema accepts named explicit selections", () => {
  const parsed = SaveNamedSelectionInputSchema.parse({
    name: "scaffold-core",
    elementIds: [1, 2, 3],
  });

  assert.equal(parsed.name, "scaffold-core");
  assert.deepEqual(parsed.elementIds, [1, 2, 3]);
});

test("ExportOxdnaBundleInputSchema sets bundle defaults", () => {
  const parsed = ExportOxdnaBundleInputSchema.parse({
    name: "design",
  });

  assert.equal(parsed.name, "design");
  assert.equal(parsed.topologyFormat, "new");
  assert.equal(parsed.includeTop, true);
  assert.equal(parsed.includeForces, true);
});
