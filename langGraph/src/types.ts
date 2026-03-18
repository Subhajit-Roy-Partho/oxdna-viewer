import type { RequestClassification, ExecutionMode } from "./tools/schemas.js";

export type GraphStatus =
  | "running"
  | "needs_confirmation"
  | "needs_clarification"
  | "completed"
  | "failed"
  | "repairing";

export type PlannedToolCall = {
  id?: string;
  name: string;
  args: Record<string, unknown>;
};

export type ToolExecutionRecord = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  success: boolean;
  mutation: boolean;
  error?: string;
};

export type VerificationResult = {
  status: "verified" | "failed" | "skipped";
  message: string;
  retryable: boolean;
};

export type ApiErrorRecord = {
  namespace: string;
  method: string;
  message: string;
  stack?: string;
  timestamp: string;
  args: string[];
};

export type SceneSummary = {
  systemCount: number;
  elementCount: number;
  selectedIds: number[];
  coloringMode: string | null;
  transformMode: string | null;
  cameraType: string | null;
  apiErrors: ApiErrorRecord[];
};

export type GraphState = {
  userRequest: string;
  normalizedRequest: string;
  executionMode: ExecutionMode;
  confirmationGranted: boolean;
  status: GraphStatus;
  classification: RequestClassification | null;
  sceneSummary: SceneSummary | null;
  assistantReasoning: string | null;
  directResponse: string | null;
  clarificationQuestion: string | null;
  confirmationPrompt: string | null;
  rawJsPreview: string | null;
  pendingToolCalls: PlannedToolCall[];
  toolResults: ToolExecutionRecord[];
  verification: VerificationResult | null;
  repairAttempts: number;
  finalResponse: string | null;
};

export type ModelPlanningResult = {
  assistantReasoning: string;
  directResponse: string | null;
  toolCalls: PlannedToolCall[];
};

export interface SessionLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runHelper<T = unknown>(helperName: string, input?: unknown): Promise<T>;
}

export interface ModelFacadeLike {
  classifyRequest(input: {
    request: string;
    executionMode: ExecutionMode;
  }): Promise<RequestClassification>;
  planWithTools(input: {
    request: string;
    executionMode: ExecutionMode;
    sceneSummary: SceneSummary | null;
    availableTools: { name: string; description: string }[];
    repairAttempts: number;
    previousFailures: string[];
  }): Promise<ModelPlanningResult>;
  generateRawJsPreview(input: {
    request: string;
    sceneSummary: SceneSummary | null;
  }): Promise<string>;
}
