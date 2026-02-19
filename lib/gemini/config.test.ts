import { afterEach, describe, expect, it } from "vitest";

import { getGeminiRuntimeConfig } from "./config";

const ENV_KEYS = [
  "GEMINI_MODEL",
  "GEMINI_MODEL_CANDIDATES",
  "GEMINI_API_VERSION",
  "GEMINI_TIMEOUT_MS",
  "GEMINI_MAX_RETRIES",
  "GEMINI_RETRY_BASE_DELAY_MS",
  "GEMINI_MAX_OUTPUT_TOKENS",
  "GEMINI_TEMPERATURE",
  "GEMINI_TOP_P",
  "GEMINI_LOG_LEVEL",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  restoreEnv();
});

describe("getGeminiRuntimeConfig", () => {
  it("falls back to single default model when candidates are missing", () => {
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    delete process.env.GEMINI_MODEL_CANDIDATES;

    const config = getGeminiRuntimeConfig();
    expect(config.model).toBe("gemini-2.0-flash");
    expect(config.modelCandidates).toEqual(["gemini-2.0-flash"]);
  });

  it("parses and deduplicates model candidates", () => {
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    process.env.GEMINI_MODEL_CANDIDATES =
      " gemini-2.0-flash, gemini-1.5-flash , gemini-2.0-flash ,,";

    const config = getGeminiRuntimeConfig();
    expect(config.modelCandidates).toEqual(["gemini-2.0-flash", "gemini-1.5-flash"]);
  });

  it("uses default model when candidates are empty entries only", () => {
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    process.env.GEMINI_MODEL_CANDIDATES = " , , ";

    const config = getGeminiRuntimeConfig();
    expect(config.modelCandidates).toEqual(["gemini-2.0-flash"]);
  });
});
