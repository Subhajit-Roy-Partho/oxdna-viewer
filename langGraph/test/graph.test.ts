import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, createOxViewGraph } from "../src/graph/buildGraph.js";
import { createOxViewTools } from "../src/tools/catalog.js";
import type { ModelFacadeLike } from "../src/types.js";

class MockSession {
  private elementCount = 100;
  private selectedIds: number[] = [];

  async connect() {}

  async disconnect() {}

  async runHelper(helperName: string, _input: unknown = {}) {
    switch (helperName) {
      case "getSceneSummary":
        return {
          systemCount: 1,
          elementCount: this.elementCount,
          selectedIds: this.selectedIds,
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
      case "createHelixBundle": {
        const createdIds = Array.from({ length: 1280 }, (_, index) => this.elementCount + index);
        this.elementCount += createdIds.length;
        this.selectedIds = createdIds;
        return {
          success: true,
          mutation: true,
          helixCount: 20,
          strandCount: 40,
          elementCount: 1280,
          idsAffected: createdIds,
        };
      }
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

test("graph can execute helix bundle creation when confirmation is granted", async () => {
  const session = new MockSession();
  const tools = createOxViewTools(session as any);
  const model: ModelFacadeLike = {
    async classifyRequest() {
      return {
        requestKind: "destructive",
        requiresConfirmation: false,
        requiresClarification: false,
        explanation: "This is a bundle creation request that can be satisfied with a typed creation tool.",
        clarificationQuestion: null,
      };
    },
    async planWithTools() {
      return {
        assistantReasoning: "Create a 20-helix DNA bundle using the typed creation tool.",
        directResponse: null,
        toolCalls: [
          {
            name: "create_helix_bundle",
            args: {
              numberOfHelices: 20,
            },
          },
        ],
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
    createInitialState("Create a 20 helix random bundle", "safe-auto", true),
  );

  assert.equal(result.status, "completed");
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0].name, "create_helix_bundle");
});

test("graph requires confirmation when the planned tool is destructive", async () => {
  const session = new MockSession();
  const tools = createOxViewTools(session as any);
  const model: ModelFacadeLike = {
    async classifyRequest() {
      return {
        requestKind: "mutating",
        requiresConfirmation: false,
        requiresClarification: false,
        explanation: "The wording is soft, but the intent is to create new geometry.",
        clarificationQuestion: null,
      };
    },
    async planWithTools() {
      return {
        assistantReasoning: "Create a new duplex with eight bases.",
        directResponse: null,
        toolCalls: [
          {
            name: "create_strand",
            args: {
              sequence: "ACGTACGT",
              duplex: true,
              polymerType: "DNA",
            },
          },
        ],
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
    createInitialState("Draw an 8 nucleotide duplex", "safe-auto"),
  );

  assert.equal(result.status, "needs_confirmation");
  assert.match(result.finalResponse, /create_strand/i);
});

test("graph fails verification when helix bundle creation does not increase the scene element count", async () => {
  class BrokenBundleSession extends MockSession {
    override async runHelper(helperName: string, input: unknown = {}) {
      if (helperName === "createHelixBundle") {
        return {
          success: true,
          mutation: true,
          helixCount: 20,
          strandCount: 40,
          elementCount: 1280,
          idsAffected: Array.from({ length: 1280 }, (_, index) => index),
        };
      }
      return super.runHelper(helperName, input);
    }
  }

  const session = new BrokenBundleSession();
  const tools = createOxViewTools(session as any);
  const model: ModelFacadeLike = {
    async classifyRequest() {
      return {
        requestKind: "mutating",
        requiresConfirmation: false,
        requiresClarification: false,
        explanation: "This is a bundle creation request that can be satisfied with a typed creation tool.",
        clarificationQuestion: null,
      };
    },
    async planWithTools() {
      return {
        assistantReasoning: "Create a 20-helix DNA bundle using the typed creation tool.",
        directResponse: null,
        toolCalls: [
          {
            name: "create_helix_bundle",
            args: {
              numberOfHelices: 20,
            },
          },
        ],
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
    maxRepairAttempts: 0,
  });

  const result = await (graph as any).invoke(
    createInitialState("Create a 20 helix random bundle", "safe-auto", true),
  );

  assert.equal(result.status, "failed");
  assert.match(result.finalResponse, /scene only grew by 0/i);
});

test("graph requires confirmation for destructive force removal", async () => {
  const session = new MockSession();
  const tools = createOxViewTools(session as any);
  const model: ModelFacadeLike = {
    async classifyRequest() {
      return {
        requestKind: "mutating",
        requiresConfirmation: false,
        requiresClarification: false,
        explanation: "The request sounds like cleanup, but it deletes force state.",
        clarificationQuestion: null,
      };
    },
    async planWithTools() {
      return {
        assistantReasoning: "Remove all currently loaded forces.",
        directResponse: null,
        toolCalls: [
          {
            name: "remove_forces",
            args: {
              all: true,
            },
          },
        ],
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
    createInitialState("Clear all forces", "safe-auto"),
  );

  assert.equal(result.status, "needs_confirmation");
  assert.match(result.finalResponse, /remove_forces/i);
});
