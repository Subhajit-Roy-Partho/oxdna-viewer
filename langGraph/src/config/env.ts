import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { ExecutionModeSchema } from "../tools/schemas.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_OPENAI_BASE_URL = "https://nano-gpt.com/api/v1";
export const DEFAULT_OPENAI_MODEL = "zai-org/glm-5.1:thinking";

loadDotenv({ path: path.join(PACKAGE_ROOT, ".env") });

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_BASE_URL: z.string().url().default(DEFAULT_OPENAI_BASE_URL),
  OPENAI_MODEL: z.string().default(DEFAULT_OPENAI_MODEL),
  OXVIEW_CDP_URL: z.string().url().default("http://127.0.0.1:9222"),
  OXVIEW_EXECUTION_MODE: ExecutionModeSchema.default("safe-auto"),
  OXVIEW_MAX_REPAIR_ATTEMPTS: z.coerce.number().int().nonnegative().default(1),
});

export type LangGraphEnv = z.infer<typeof EnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): LangGraphEnv {
  return EnvSchema.parse(env);
}
