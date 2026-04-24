import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { OxViewCDPSession } from "../runtime/cdpSession.js";
import type { OpenAIModelFacade } from "../runtime/modelFacade.js";
import type {
  GraphState,
  ModelFacadeLike,
  PlannedToolCall,
  SessionLike,
  ToolExecutionRecord,
  VerificationResult,
} from "../types.js";
import type { ExecutionMode } from "../tools/schemas.js";

type GraphRuntime = {
  session: SessionLike;
  model: ModelFacadeLike;
  availableTools: { name: string; description: string }[];
  toolMap: Map<string, { mutation: boolean; tool: { invoke(input: unknown): Promise<unknown> } }>;
  executionMode: ExecutionMode;
  maxRepairAttempts: number;
};

const replace = <T>(defaultValue: () => T) =>
  Annotation<T>({
    reducer: (_left: T, right: T) => (right === undefined ? _left : right),
    default: defaultValue,
  });

const GraphStateAnnotation = Annotation.Root({
  userRequest: replace(() => ""),
  normalizedRequest: replace(() => ""),
  executionMode: replace<ExecutionMode>(() => "safe-auto"),
  confirmationGranted: replace(() => false),
  status: replace<GraphState["status"]>(() => "running"),
  classification: replace<GraphState["classification"]>(() => null),
  sceneSummary: replace<GraphState["sceneSummary"]>(() => null),
  assistantReasoning: replace(() => null),
  directResponse: replace(() => null),
  clarificationQuestion: replace(() => null),
  confirmationPrompt: replace(() => null),
  rawJsPreview: replace(() => null),
  pendingToolCalls: replace<PlannedToolCall[]>(() => []),
  toolResults: replace<ToolExecutionRecord[]>(() => []),
  verification: replace<VerificationResult | null>(() => null),
  repairAttempts: replace(() => 0),
  finalResponse: replace(() => null),
});

function formatToolCalls(toolCalls: PlannedToolCall[]): string {
  if (toolCalls.length === 0) {
    return "No tool calls were planned.";
  }

  return toolCalls
    .map(
      (toolCall, index) =>
        `${index + 1}. ${toolCall.name}(${JSON.stringify(toolCall.args)})`,
    )
    .join("\n");
}

function summarizeToolResults(toolResults: ToolExecutionRecord[]): string {
  if (toolResults.length === 0) {
    return "No tools were executed.";
  }

  return toolResults
    .map((result) => {
      const prefix = result.success ? "OK" : "FAIL";
      return `${prefix}: ${result.name} ${JSON.stringify(result.args)}`;
    })
    .join("\n");
}

function getNumericResultField(result: unknown, field: string): number | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const value = (result as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getResultIds(result: unknown): number[] {
  if (!result || typeof result !== "object") {
    return [];
  }

  const ids = (result as Record<string, unknown>).idsAffected;
  if (!Array.isArray(ids)) {
    return [];
  }

  return ids.filter((value): value is number => Number.isInteger(value));
}

async function ingestRequestNode(state: GraphState) {
  return {
    normalizedRequest: state.userRequest.trim(),
    status: "running" as const,
    assistantReasoning: null,
    directResponse: null,
    clarificationQuestion: null,
    confirmationPrompt: null,
    rawJsPreview: null,
    pendingToolCalls: [],
    toolResults: [],
    verification: null,
    finalResponse: null,
  };
}

async function classifyRequestNode(state: GraphState, runtime: GraphRuntime) {
  const classification = await runtime.model.classifyRequest({
    request: state.normalizedRequest,
    executionMode: state.executionMode,
  });

  return {
    classification,
  };
}

async function loadContextNode(_state: GraphState, runtime: GraphRuntime) {
  const sceneSummary = await runtime.session.runHelper<GraphState["sceneSummary"]>(
    "getSceneSummary",
    { includeSelection: true },
  );

  return {
    sceneSummary,
  };
}

async function planToolsNode(state: GraphState, runtime: GraphRuntime) {
  const planningResult = await runtime.model.planWithTools({
    request: state.normalizedRequest,
    executionMode: state.executionMode,
    sceneSummary: state.sceneSummary,
    availableTools: runtime.availableTools,
    repairAttempts: state.repairAttempts,
    previousFailures: state.toolResults
      .filter((result) => !result.success)
      .map((result) => result.error ?? `${result.name} failed.`),
  });

  let rawJsPreview: string | null = null;
  if (!planningResult.directResponse && planningResult.toolCalls.length === 0) {
    rawJsPreview = await runtime.model.generateRawJsPreview({
      request: state.normalizedRequest,
      sceneSummary: state.sceneSummary,
    });
  }

  return {
    assistantReasoning: planningResult.assistantReasoning,
    directResponse: planningResult.directResponse,
    pendingToolCalls: planningResult.toolCalls,
    rawJsPreview,
  };
}

async function clarifyOrConfirmNode(state: GraphState) {
  if (state.classification?.requiresClarification) {
    return {
      status: "needs_clarification" as const,
      clarificationQuestion:
        state.classification.clarificationQuestion ??
        "I need a little more detail before I can act on that request.",
    };
  }

  const confirmationRequired =
    state.executionMode === "always-preview" ||
    state.classification?.requiresConfirmation ||
    Boolean(state.rawJsPreview);

  if (confirmationRequired && !state.confirmationGranted) {
    const confirmationPrompt = [
      "This request needs confirmation before execution.",
      state.assistantReasoning ? `Reasoning: ${state.assistantReasoning}` : null,
      `Planned tool calls:\n${formatToolCalls(state.pendingToolCalls)}`,
      state.rawJsPreview ? `Fallback JS preview:\n${state.rawJsPreview}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      status: "needs_confirmation" as const,
      confirmationPrompt,
    };
  }

  return {
    status: "running" as const,
  };
}

async function executeToolsNode(state: GraphState, runtime: GraphRuntime) {
  const toolResults: ToolExecutionRecord[] = [];

  for (const pendingTool of state.pendingToolCalls) {
    const definition = runtime.toolMap.get(pendingTool.name);
    if (!definition) {
      toolResults.push({
        name: pendingTool.name,
        args: pendingTool.args,
        result: null,
        success: false,
        mutation: false,
        error: `Unknown tool ${pendingTool.name}`,
      });
      break;
    }

    try {
      const result = await definition.tool.invoke(pendingTool.args);
      const success = !(result && typeof result === "object" && (result as any).success === false);
      toolResults.push({
        name: pendingTool.name,
        args: pendingTool.args,
        result,
        success,
        mutation: definition.mutation,
      });
      if (!success) {
        break;
      }
    } catch (error) {
      toolResults.push({
        name: pendingTool.name,
        args: pendingTool.args,
        result: null,
        success: false,
        mutation: definition.mutation,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  return {
    toolResults,
  };
}

async function verifyOutcomeNode(state: GraphState, runtime: GraphRuntime) {
  const mutatingResults = state.toolResults.filter((result) => result.mutation);
  if (mutatingResults.length === 0) {
    return {
      verification: {
        status: "skipped",
        message: "No mutating tools were executed.",
        retryable: false,
      } satisfies VerificationResult,
    };
  }

  const apiErrors = await runtime.session.runHelper<{
    last: { message?: string } | null;
    history: unknown[];
  }>("getApiErrors", {});
  const postSceneSummary = await runtime.session.runHelper<GraphState["sceneSummary"]>(
    "getSceneSummary",
    { includeSelection: true },
  );

  const failedTool = state.toolResults.find((result) => !result.success);
  if (failedTool) {
    return {
      verification: {
        status: "failed",
        message: failedTool.error ?? `${failedTool.name} failed.`,
        retryable: state.repairAttempts < runtime.maxRepairAttempts,
      } satisfies VerificationResult,
    };
  }

  if (apiErrors.last) {
    return {
      verification: {
        status: "failed",
        message: apiErrors.last.message ?? "oxView reported an API error after execution.",
        retryable: state.repairAttempts < runtime.maxRepairAttempts,
      } satisfies VerificationResult,
    };
  }

  const createdBundleResults = state.toolResults.filter(
    (result) => result.success && result.name === "create_helix_bundle",
  );
  if (createdBundleResults.length > 0 && state.sceneSummary && postSceneSummary) {
    const expectedCreatedCount = createdBundleResults.reduce((sum, result) => {
      const reportedCount = getNumericResultField(result.result, "elementCount");
      return sum + (reportedCount ?? getResultIds(result.result).length);
    }, 0);
    const actualCreatedCount = postSceneSummary.elementCount - state.sceneSummary.elementCount;

    if (expectedCreatedCount > 0 && actualCreatedCount < expectedCreatedCount) {
      return {
        verification: {
          status: "failed",
          message:
            `Bundle creation reported ${expectedCreatedCount} new elements, but the scene only grew by ${actualCreatedCount}.`,
          retryable: state.repairAttempts < runtime.maxRepairAttempts,
        } satisfies VerificationResult,
      };
    }
  }

  return {
    verification: {
      status: "verified",
      message: "Mutating tool calls completed successfully and oxView reported no API errors.",
      retryable: false,
    } satisfies VerificationResult,
  };
}

async function repairOrFinalizeNode(state: GraphState, runtime: GraphRuntime) {
  if (
    state.verification?.status === "failed" &&
    state.repairAttempts < runtime.maxRepairAttempts
  ) {
    return {
      repairAttempts: state.repairAttempts + 1,
      status: "repairing" as const,
      pendingToolCalls: [],
      toolResults: [],
    };
  }

  return {};
}

async function respondNode(state: GraphState) {
  if (state.status === "needs_clarification") {
    return {
      finalResponse:
        state.clarificationQuestion ??
        "I need clarification before I can continue.",
    };
  }

  if (state.status === "needs_confirmation") {
    return {
      finalResponse:
        state.confirmationPrompt ??
        "This request needs confirmation before execution.",
    };
  }

  if (state.verification?.status === "failed") {
    return {
      status: "failed" as const,
      finalResponse: [
        "I could not complete the request cleanly.",
        state.assistantReasoning ? `Planner notes: ${state.assistantReasoning}` : null,
        `Verification failure: ${state.verification.message}`,
        state.rawJsPreview ? `Fallback preview:\n${state.rawJsPreview}` : null,
        `Executed tools:\n${summarizeToolResults(state.toolResults)}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  if (state.directResponse && state.toolResults.length === 0) {
    return {
      status: "completed" as const,
      finalResponse: state.directResponse,
    };
  }

  return {
    status: "completed" as const,
    finalResponse: [
      state.assistantReasoning ? `Reasoning: ${state.assistantReasoning}` : null,
      `Executed tools:\n${summarizeToolResults(state.toolResults)}`,
      state.verification ? `Verification: ${state.verification.message}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function createInitialState(
  userRequest: string,
  executionMode: ExecutionMode,
  confirmationGranted = false,
): GraphState {
  return {
    userRequest,
    normalizedRequest: "",
    executionMode,
    confirmationGranted,
    status: "running",
    classification: null,
    sceneSummary: null,
    assistantReasoning: null,
    directResponse: null,
    clarificationQuestion: null,
    confirmationPrompt: null,
    rawJsPreview: null,
    pendingToolCalls: [],
    toolResults: [],
    verification: null,
    repairAttempts: 0,
    finalResponse: null,
  };
}

export function createOxViewGraph(runtime: GraphRuntime) {
  return new StateGraph(GraphStateAnnotation)
    .addNode("ingest_request", (state) => ingestRequestNode(state))
    .addNode("classify_request", (state) => classifyRequestNode(state, runtime))
    .addNode("load_context", (state) => loadContextNode(state, runtime))
    .addNode("plan_tools", (state) => planToolsNode(state, runtime))
    .addNode("clarify_or_confirm", (state) => clarifyOrConfirmNode(state))
    .addNode("execute_tools", (state) => executeToolsNode(state, runtime))
    .addNode("verify_outcome", (state) => verifyOutcomeNode(state, runtime))
    .addNode("repair_or_finalize", (state) => repairOrFinalizeNode(state, runtime))
    .addNode("respond", (state) => respondNode(state))
    .addEdge(START, "ingest_request")
    .addEdge("ingest_request", "classify_request")
    .addEdge("classify_request", "load_context")
    .addEdge("load_context", "plan_tools")
    .addEdge("plan_tools", "clarify_or_confirm")
    .addConditionalEdges(
      "clarify_or_confirm",
      (state) => {
        if (state.status === "needs_clarification") return "respond";
        if (state.status === "needs_confirmation") return "respond";
        return "execute_tools";
      },
      {
        respond: "respond",
        execute_tools: "execute_tools",
      },
    )
    .addEdge("execute_tools", "verify_outcome")
    .addEdge("verify_outcome", "repair_or_finalize")
    .addConditionalEdges(
      "repair_or_finalize",
      (state) => (state.status === "repairing" ? "load_context" : "respond"),
      {
        load_context: "load_context",
        respond: "respond",
      },
    )
    .addEdge("respond", END)
    .compile();
}
