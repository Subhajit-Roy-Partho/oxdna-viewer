import test from "node:test";
import assert from "node:assert/strict";
import {
  ColorElementsInputSchema,
  ElementFilterSchema,
  RequestClassificationSchema,
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
