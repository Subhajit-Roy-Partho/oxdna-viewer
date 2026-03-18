import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadEnv } from "../config/env.js";
import { createOxViewGraph, createInitialState } from "../graph/buildGraph.js";
import { OxViewCDPSession } from "../runtime/cdpSession.js";
import { OpenAIModelFacade } from "../runtime/modelFacade.js";
import { createOxViewTools } from "../tools/catalog.js";

async function main() {
  const env = loadEnv();
  const session = new OxViewCDPSession({ baseUrl: env.OXVIEW_CDP_URL });
  await session.connect();

  const model = new OpenAIModelFacade({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
  });
  const toolCatalog = createOxViewTools(session);
  const graph = createOxViewGraph({
    session,
    model,
    availableTools: toolCatalog.availableTools,
    toolMap: toolCatalog.toolMap,
    executionMode: env.OXVIEW_EXECUTION_MODE,
    maxRepairAttempts: env.OXVIEW_MAX_REPAIR_ATTEMPTS,
  });

  const rl = readline.createInterface({ input, output });
  console.log("oxView LangGraph helper connected. Type 'exit' to quit.");

  try {
    while (true) {
      const request = (await rl.question("oxview> ")).trim();
      if (!request) continue;
      if (request.toLowerCase() === "exit") break;

      let state = await (graph as any).invoke(
        createInitialState(request, env.OXVIEW_EXECUTION_MODE, false),
      );

      if (state.status === "needs_clarification") {
        console.log(state.finalResponse);
        continue;
      }

      if (state.status === "needs_confirmation") {
        console.log(state.finalResponse);
        const answer = (
          await rl.question("Execute this request? [y/N] ")
        ).trim();
        if (/^y(es)?$/i.test(answer)) {
          state = await (graph as any).invoke(
            createInitialState(request, env.OXVIEW_EXECUTION_MODE, true),
          );
        }
      }

      console.log(state.finalResponse ?? "No response was produced.");
    }
  } finally {
    rl.close();
    await session.disconnect();
  }
}

main().catch((error) => {
  console.error("LangGraph CLI failed:", error);
  process.exitCode = 1;
});
