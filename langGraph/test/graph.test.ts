import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, createOxViewGraph } from "../src/graph/buildGraph.js";
import { createOxViewTools } from "../src/tools/catalog.js";
import type { ModelFacadeLike } from "../src/types.js";

class MockSession {
  async connect() {}

  async disconnect() {}

  async runHelper(helperName: string, _input: unknown = {}) {
    switch (helperName) {
      case "getSceneSummary":
        return {
          systemCount: 1,
          elementCount: 100,
          selectedIds: [],
          coloringMode: "Strand",
          transformMode: "Translate",
          cameraType: "PerspectiveCamera",
          apiErrors: [],
        };
      case "colorElements":
        return {
          success: true,
          mutation: true,
          idsAffected: [1, 3, 5],
        };
      case "getApiErrors":
        return {
          last: null,
          history: [],
        };
      default:
        return {};
    }
  }
}

test("graph completes a safe mutating request", async () => {
  const session = new MockSession();
  const tools = createOxViewTools(session as any);
  const model: ModelFacadeLike = {
    async classifyRequest() {
      return {
        requestKind: "mutating",
        requiresConfirmation: false,
        requiresClarification: false,
        explanation: "This is a safe custom-color request.",
        clarificationQuestion: null,
      };
    },
    async planWithTools() {
      return {
        assistantReasoning: "Find odd ids and color them green.",
        directResponse: null,
        toolCalls: [
          {
            name: "color_elements",
            args: {
              filter: { parity: "odd", elementKinds: ["nucleotide"] },
              color: "#00ff00",
              applyTo: "custom",
            },
          },
        ],
      };
    },
    async generateRawJsPreview() {
      return "colorElements(new THREE.Color('#00ff00'));";
    },
  };

  const graph = createOxViewGraph({
    session,
    model,
    availableTools: tools.availableTools,
    toolMap: tools.toolMap as any,
    executionMode: "safe-auto",
    maxRepairAttempts: 1,
  });

  const result = await (graph as any).invoke(
    createInitialState("Color every odd nucleotide green", "safe-auto"),
  );

  assert.equal(result.status, "completed");
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0].name, "color_elements");
});

test("graph asks for clarification on ambiguous numeric nucleotide targets", async () => {
  const session = new MockSession();
  const tools = createOxViewTools(session as any);
  const model: ModelFacadeLike = {
    async classifyRequest() {
      return {
        requestKind: "ambiguous",
        requiresConfirmation: false,
        requiresClarification: true,
        explanation: "The target could refer to an id or a base type.",
        clarificationQuestion: "Do you mean element ID 13, or base/type 13?",
      };
    },
    async planWithTools() {
      return {
        assistantReasoning: "",
        directResponse: null,
        toolCalls: [],
      };
    },
    async generateRawJsPreview() {
      return "";
    },
  };

  const graph = createOxViewGraph({
    session,
    model,
    availableTools: tools.availableTools,
    toolMap: tools.toolMap as any,
    executionMode: "safe-auto",
    maxRepairAttempts: 1,
  });

  const result = await (graph as any).invoke(
    createInitialState("Select all the nucleotide 13", "safe-auto"),
  );

  assert.equal(result.status, "needs_clarification");
  assert.match(result.finalResponse, /element ID 13/i);
});
