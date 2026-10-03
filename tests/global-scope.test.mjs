// Regression: classic <script> files share one global scope, so a top-level
// `const`/`let` declared in two of them is a SyntaxError that stops the
// second file entirely (ts/agent_chat.js was silently dead because of a
// duplicated TELEGRAM_BOT_TOKEN_DEFAULT). Load the two chat scripts in page
// order into ONE vm context and assert both define their entry points.
//   node tests/global-scope.test.mjs
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = { OXVIEW_CONFIG: {}, addEventListener() {}, location: { href: "http://x/" } };
const ctx = vm.createContext({
  window: win, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} } },
  console, setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => ({}) }),
  navigator: {}, notify() {}, view: {}, elements: new Map(), systems: [], selectedBases: new Set(),
});
let failed = 0;
for (const f of ["ts/llm_chat.js", "ts/agent_chat.js"]) {
  try {
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
    console.log(`ok   - ${f} loads in shared scope`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL - ${f}: ${e.name}: ${e.message}`);
  }
}
const resolver = vm.runInContext("typeof resolveTelegramBotToken", ctx);
if (resolver === "function") console.log("ok   - resolveTelegramBotToken defined"); else { failed += 1; console.log("FAIL - resolveTelegramBotToken missing"); }
process.exit(failed ? 1 : 0);
