import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  loadEnv,
} from "../src/config/env.js";

test("loadEnv applies Nano GPT defaults", () => {
  const parsed = loadEnv({
    OPENAI_API_KEY: "test-key",
  });

  assert.equal(parsed.OPENAI_BASE_URL, DEFAULT_OPENAI_BASE_URL);
  assert.equal(parsed.OPENAI_MODEL, DEFAULT_OPENAI_MODEL);
  assert.equal(parsed.OXVIEW_CDP_URL, "http://127.0.0.1:9222");
});

test("loadEnv respects explicit overrides", () => {
  const parsed = loadEnv({
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: "https://example.com/v1",
    OPENAI_MODEL: "example/model",
    OXVIEW_CDP_URL: "http://127.0.0.1:9333",
    OXVIEW_EXECUTION_MODE: "always-preview",
    OXVIEW_MAX_REPAIR_ATTEMPTS: "2",
  });

  assert.equal(parsed.OPENAI_BASE_URL, "https://example.com/v1");
  assert.equal(parsed.OPENAI_MODEL, "example/model");
  assert.equal(parsed.OXVIEW_CDP_URL, "http://127.0.0.1:9333");
  assert.equal(parsed.OXVIEW_EXECUTION_MODE, "always-preview");
  assert.equal(parsed.OXVIEW_MAX_REPAIR_ATTEMPTS, 2);
});
