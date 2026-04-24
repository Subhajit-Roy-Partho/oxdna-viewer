import test from "node:test";
import assert from "node:assert/strict";
import { createOxViewTools } from "../src/tools/catalog.js";

class MockSession {
  calls: Array<{ helperName: string; input: unknown }> = [];

  async connect() {}

  async disconnect() {}

  async runHelper(helperName: string, input: unknown = {}) {
    this.calls.push({ helperName, input });
    switch (helperName) {
      case "findElements":
        return { ids: [1, 3, 5], count: 3 };
      case "colorElements":
        return { success: true, idsAffected: [1, 3, 5] };
      case "createHelixBundle":
        return {
          success: true,
          helixCount: 20,
          strandCount: 40,
          elementCount: 1280,
        };
      default:
        return { ok: true };
    }
  }
}

test("tool catalog delegates to the session helper layer", async () => {
  const session = new MockSession();
  const catalog = createOxViewTools(session as any);

  const findResult = await catalog.toolMap
    .get("find_elements")!
    .tool.invoke({ filter: { parity: "odd" } });
  const colorResult = await catalog.toolMap
    .get("color_elements")!
    .tool.invoke({
      filter: { ids: [1, 3, 5] },
      color: "#00ff00",
      applyTo: "custom",
    });
  const bundleResult = await catalog.toolMap
    .get("create_helix_bundle")!
    .tool.invoke({
      numberOfHelices: 20,
    });

  assert.deepEqual(findResult.ids, [1, 3, 5]);
  assert.equal(colorResult.success, true);
  assert.equal(bundleResult.helixCount, 20);
  assert.equal(session.calls[0].helperName, "findElements");
  assert.equal(session.calls[1].helperName, "colorElements");
  assert.equal(session.calls[2].helperName, "createHelixBundle");
});
