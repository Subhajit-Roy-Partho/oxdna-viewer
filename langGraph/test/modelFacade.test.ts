import test from "node:test";
import assert from "node:assert/strict";
import { applyToolCallHeuristics } from "../src/runtime/modelFacade.js";

test("applyToolCallHeuristics fills in helix bundle counts from the request", () => {
  const toolCalls = applyToolCallHeuristics("Creat a 20 helix random bundle", [
    {
      name: "create_helix_bundle",
      args: {},
    },
  ]);

  assert.equal(toolCalls[0].args.numberOfHelices, 20);
});

test("applyToolCallHeuristics fills in base-pair length and polymer type", () => {
  const toolCalls = applyToolCallHeuristics("Create a 12 helix 48 bp RNA bundle", [
    {
      name: "create_helix_bundle",
      args: {},
    },
  ]);

  assert.equal(toolCalls[0].args.numberOfHelices, 12);
  assert.equal(toolCalls[0].args.basePairsPerHelix, 48);
  assert.equal(toolCalls[0].args.nucleicAcidType, "RNA");
});
