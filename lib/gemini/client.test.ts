import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors/app-error";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = {
      generateContent: generateContentMock,
    };
  }

  return { GoogleGenAI };
});

vi.mock("./config", () => ({
  getGeminiRuntimeConfig: vi.fn(),
}));

import { getGeminiRuntimeConfig } from "./config";
import { generateWithGemini } from "./client";

const mockedGetGeminiRuntimeConfig = vi.mocked(getGeminiRuntimeConfig);

function buildConfig(overrides: Partial<ReturnType<typeof getGeminiRuntimeConfig>> = {}) {
  return {
    model: "gemini-2.0-flash",
    modelCandidates: ["gemini-2.0-flash"],
    apiVersion: "v1",
    timeoutMs: 1_000,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    maxOutputTokens: 800,
    temperature: 0.2,
    topP: 0.9,
    logLevel: "info" as const,
    ...overrides,
  };
}

beforeEach(() => {
  generateContentMock.mockReset();
  mockedGetGeminiRuntimeConfig.mockReset();
  process.env.GEMINI_API_KEY = "test-api-key";
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe("generateWithGemini", () => {
  it("fails over to next model candidate when first model is repeatedly rate-limited", async () => {
    mockedGetGeminiRuntimeConfig.mockReturnValue(
      buildConfig({
        model: "gemini-2.0-flash",
        modelCandidates: ["gemini-2.0-flash", "gemini-1.5-flash"],
        maxRetries: 1,
      }),
    );

    generateContentMock
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { status: 429 }))
      .mockResolvedValueOnce({
        text: "TL;DR\n- 핵심 1\n- 핵심 2\n- 핵심 3\n\n전체 요약\n정상 응답",
        sdkHttpResponse: { responseInternal: { status: 200 } },
      });

    const result = await generateWithGemini("prompt", { requestId: "test-request" });
    expect(result).toContain("정상 응답");
    expect(generateContentMock.mock.calls.map((call) => call[0]?.model)).toEqual([
      "gemini-2.0-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ]);
  });

  it("throws GEMINI_REQUEST_FAILED when all model candidates are exhausted by 429", async () => {
    mockedGetGeminiRuntimeConfig.mockReturnValue(
      buildConfig({
        modelCandidates: ["gemini-2.0-flash", "gemini-1.5-flash"],
        maxRetries: 0,
      }),
    );

    generateContentMock
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { status: 429 }));

    await expect(generateWithGemini("prompt", { requestId: "test-request" })).rejects.toMatchObject({
      code: "GEMINI_REQUEST_FAILED",
    });
    expect(generateContentMock.mock.calls.map((call) => call[0]?.model)).toEqual([
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ]);
  });

  it("does not switch model for non-retryable errors", async () => {
    mockedGetGeminiRuntimeConfig.mockReturnValue(
      buildConfig({
        modelCandidates: ["gemini-2.0-flash", "gemini-1.5-flash"],
        maxRetries: 0,
      }),
    );

    generateContentMock.mockRejectedValueOnce(Object.assign(new Error("bad request"), { status: 400 }));

    await expect(generateWithGemini("prompt", { requestId: "test-request" })).rejects.toBeInstanceOf(
      AppError,
    );
    expect(generateContentMock.mock.calls.map((call) => call[0]?.model)).toEqual([
      "gemini-2.0-flash",
    ]);
  });

  it("switches candidate when current model is unavailable (404)", async () => {
    mockedGetGeminiRuntimeConfig.mockReturnValue(
      buildConfig({
        modelCandidates: ["gemini-1.5-flash", "gemini-2.0-flash"],
        maxRetries: 0,
      }),
    );

    generateContentMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error("Model gemini-1.5-flash not found for API version v1"),
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce({
        text: "TL;DR\n- 핵심 1\n- 핵심 2\n- 핵심 3\n\n전체 요약\n정상 응답",
        sdkHttpResponse: { responseInternal: { status: 200 } },
      });

    const result = await generateWithGemini("prompt", { requestId: "test-request" });
    expect(result).toContain("정상 응답");
    expect(generateContentMock.mock.calls.map((call) => call[0]?.model)).toEqual([
      "gemini-1.5-flash",
      "gemini-2.0-flash",
    ]);
  });

  it("throws GEMINI_CONFIG_INVALID when no usable model candidate remains", async () => {
    mockedGetGeminiRuntimeConfig.mockReturnValue(
      buildConfig({
        modelCandidates: ["gemini-1.5-flash"],
        maxRetries: 0,
      }),
    );

    generateContentMock.mockRejectedValueOnce(
      Object.assign(new Error("Model gemini-1.5-flash not found for API version v1"), {
        status: 404,
      }),
    );

    await expect(generateWithGemini("prompt", { requestId: "test-request" })).rejects.toMatchObject({
      code: "GEMINI_CONFIG_INVALID",
    });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});
