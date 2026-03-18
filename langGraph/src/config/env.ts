import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { ExecutionModeSchema } from "../tools/schemas.js";

loadDotenv();

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OXVIEW_CDP_URL: z.string().url().default("http://127.0.0.1:9222"),
  OXVIEW_EXECUTION_MODE: ExecutionModeSchema.default("safe-auto"),
  OXVIEW_MAX_REPAIR_ATTEMPTS: z.coerce.number().int().nonnegative().default(1),
});

export type LangGraphEnv = z.infer<typeof EnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): LangGraphEnv {
  return EnvSchema.parse(env);
}
