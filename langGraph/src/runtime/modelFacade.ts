import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {
  RequestClassificationSchema,
  type ExecutionMode,
  type RequestClassification,
} from "../tools/schemas.js";
import type {
  AvailableToolMetadata,
  ModelFacadeLike,
  ModelPlanningResult,
  SceneSummary,
} from "../types.js";

const CLASSIFICATION_SYSTEM_PROMPT = `You classify oxView assistant requests.

Rules:
- "read" means the user is only asking for information.
- "mutating" means the user wants a reversible, non-destructive scene/view/update action.
- "destructive" means edits like delete, skip, ligate, nick, insert, extend, split, create, draw, build, set-sequence, or other topology-changing commands.
- "ambiguous" means the target cannot be resolved safely, for example "select nucleotide 13" when it could mean element id 13 or base type 13.

Honor the execution mode:
- safe-auto: safe, reversible, unambiguous changes can auto-execute; destructive actions require confirmation.
- always-preview: any mutating action requires confirmation.
- always-execute: only ambiguity should block execution.

Return concise explanations.`;

const PLANNER_SYSTEM_PROMPT = `You are the oxView LangGraph planner. You must use typed tool calls whenever they can satisfy the request.

Guidelines:
- Prefer read tools first when you need scene grounding.
- Prefer find_elements + action tools over inventing raw JavaScript.
- For requests to create a new random multi-helix bundle, use create_helix_bundle instead of refusing or falling back to raw JavaScript.
- When the user specifies a helix count or base-pair length for create_helix_bundle, include those values in the tool arguments.
- For requests like "create a 20 nucleotide DNA duplex", use create_strand with length, duplex=true, and the requested polymerType.
- Use the minimum number of tool calls needed to satisfy the request.
- If the request is informational, you may answer directly without tools only when the answer is obvious from the provided scene summary.
- If the request is ambiguous, do not guess.
- Do not issue destructive edit-style actions unless the surrounding graph has already approved execution.
- For requests like "every odd nucleotide", interpret odd/even over global element ids unless the user explicitly says otherwise.
- For color changes, prefer the custom/base/backbone modes exposed by the available tools.
- Prefer one semantic destructive tool over multiple low-level destructive steps when such a tool exists.
- Respect the provided tool schemas exactly.
- Use selection/view tools only when they help satisfy the request; explicit-id edit tools are preferred for topology changes.`;

const RAW_JS_PREVIEW_PROMPT = `You are generating a PREVIEW ONLY oxView JavaScript snippet.

Rules:
- Do not explain anything outside the code.
- Do not wrap the code in markdown fences.
- Use existing oxView globals like api, edit, scene, systems, elements, colorElements, render.
- Prefer concise code that could be shown to a user for approval.
- Never claim the code has executed.`;

function applyClassificationHeuristics(
  request: string,
  executionMode: ExecutionMode,
): Partial<RequestClassification> {
  const lowered = request.toLowerCase();

  const isAmbiguousNumericNucleotide =
    /\bnucleotide\s+\d+\b/i.test(request) && !/\b(element|id)\b/i.test(request);
  if (isAmbiguousNumericNucleotide) {
    return {
      requestKind: "ambiguous",
      requiresClarification: true,
      requiresConfirmation: false,
      explanation:
        "The request refers to a numbered nucleotide without saying whether that number is an element id or a base/type filter.",
      clarificationQuestion:
        "Do you mean element ID 13, or all nucleotides with type/base 13?",
    };
  }

  const destructivePattern =
    /\b(delete|remove|skip|ligate|nick|insert|extend|split|create|draw|build|make|set sequence|change sequence|redo|undo)\b/i;
  const definitelyReadOnly =
    /\b(get|show|list|count|what|which|where|distance|position|orientation|info|trace|summary)\b/i;

  const isDestructive = destructivePattern.test(lowered);
  const isReadOnly =
    definitelyReadOnly.test(lowered) && !/\b(select|color|focus|toggle|change|set)\b/i.test(lowered);

  const requiresConfirmation =
    executionMode === "always-preview"
      ? !isReadOnly
      : executionMode === "always-execute"
        ? false
        : isDestructive;

  return {
    requestKind: isReadOnly ? "read" : isDestructive ? "destructive" : "mutating",
    requiresClarification: false,
    requiresConfirmation,
  };
}

export function applyToolCallHeuristics(
  request: string,
  toolCalls: Array<{
    id?: string;
    name: string;
    args: Record<string, unknown>;
  }>,
) {
  const helixCountMatch = request.match(/\b(\d+)\s*[- ]?helix(?:es)?\b/i);
  const basePairMatch = request.match(/\b(\d+)\s*(?:bp|base ?pairs?)\b/i);
  const nucleotideLengthMatch = request.match(
    /\b(\d+)\s*(?:nt|nucleotides?|bases?)\b/i,
  );
  const mentionsDuplex = /\bduplex\b/i.test(request);
  const mentionsRNA = /\brna\b/i.test(request);
  const mentionsDNA = /\bdna\b/i.test(request);

  return toolCalls.map((toolCall) => {
    const args = { ...toolCall.args };

    if (toolCall.name === "create_helix_bundle") {
      if (args.numberOfHelices === undefined && helixCountMatch) {
        args.numberOfHelices = Number(helixCountMatch[1]);
      }
      if (args.basePairsPerHelix === undefined && basePairMatch) {
        args.basePairsPerHelix = Number(basePairMatch[1]);
      }
      if (args.nucleicAcidType === undefined) {
        if (mentionsRNA) {
          args.nucleicAcidType = "RNA";
        } else if (mentionsDNA) {
          args.nucleicAcidType = "DNA";
        }
      }
    }

    if (toolCall.name === "create_strand") {
      if (
        args.sequence === undefined &&
        args.length === undefined &&
        nucleotideLengthMatch
      ) {
        args.length = Number(nucleotideLengthMatch[1]);
      }
      if (args.duplex === undefined && mentionsDuplex) {
        args.duplex = true;
      }
      if (args.polymerType === undefined) {
        if (mentionsRNA) {
          args.polymerType = "RNA";
        } else if (mentionsDNA) {
          args.polymerType = "DNA";
        }
      }
    }

    return {
      ...toolCall,
      args,
    };
  });
}

export class OpenAIModelFacade implements ModelFacadeLike {
  private readonly model: ChatOpenAI;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.model = new ChatOpenAI({
      apiKey: options.apiKey,
      model: options.model,
      temperature: 0,
      useResponsesApi: false,
      configuration: options.baseUrl
        ? {
            baseURL: options.baseUrl,
          }
        : undefined,
    });
  }

  async classifyRequest(input: {
    request: string;
    executionMode: ExecutionMode;
  }): Promise<RequestClassification> {
    const heuristic = applyClassificationHeuristics(input.request, input.executionMode);
    if (heuristic.requestKind === "ambiguous") {
      return RequestClassificationSchema.parse(heuristic);
    }

    const classifier = this.model.withStructuredOutput(RequestClassificationSchema);
    const result = await classifier.invoke([
      new SystemMessage(CLASSIFICATION_SYSTEM_PROMPT),
      new HumanMessage(
        JSON.stringify({
          request: input.request,
          executionMode: input.executionMode,
          heuristic,
        }),
      ),
    ]);

    return RequestClassificationSchema.parse({
      ...result,
      ...heuristic,
    });
  }

  async planWithTools(input: {
    request: string;
    executionMode: ExecutionMode;
    sceneSummary: SceneSummary | null;
    availableTools: AvailableToolMetadata[];
    repairAttempts: number;
    previousFailures: string[];
  }): Promise<ModelPlanningResult> {
    const boundModel = this.model.bindTools(
      input.availableTools.map((toolMeta) => ({
        type: "function" as const,
        function: {
          name: toolMeta.name,
          description: toolMeta.description,
          parameters: toolMeta.jsonSchema,
        },
      })),
    );

    const response = await boundModel.invoke([
      new SystemMessage(PLANNER_SYSTEM_PROMPT),
      new HumanMessage(
        JSON.stringify({
          request: input.request,
          executionMode: input.executionMode,
          sceneSummary: input.sceneSummary,
          repairAttempts: input.repairAttempts,
          previousFailures: input.previousFailures,
          availableTools: input.availableTools.map((toolMeta) => ({
            name: toolMeta.name,
            description: toolMeta.description,
            risk: toolMeta.risk,
            category: toolMeta.category,
          })),
        }),
      ),
    ]);

    const toolCalls = applyToolCallHeuristics(
      input.request,
      response.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: (toolCall.args ?? {}) as Record<string, unknown>,
      })) ?? [],
    );

    return {
      assistantReasoning:
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content ?? ""),
      directResponse:
        toolCalls.length === 0 && typeof response.content === "string"
          ? response.content
          : null,
      toolCalls,
    };
  }

  async generateRawJsPreview(input: {
    request: string;
    sceneSummary: SceneSummary | null;
  }): Promise<string> {
    const response = await this.model.invoke([
      new SystemMessage(RAW_JS_PREVIEW_PROMPT),
      new HumanMessage(
        JSON.stringify({
          request: input.request,
          sceneSummary: input.sceneSummary,
        }),
      ),
    ]);

    return typeof response.content === "string"
      ? response.content.trim()
      : JSON.stringify(response.content ?? "");
  }
}
