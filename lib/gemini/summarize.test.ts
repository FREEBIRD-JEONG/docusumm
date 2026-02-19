import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../errors/app-error";

vi.mock("./client", () => ({
  generateWithGemini: vi.fn(),
}));
vi.mock("@/lib/youtube/transcript", () => ({
  buildYouTubePromptContext: vi.fn(),
}));

import { generateWithGemini } from "./client";
import { buildFallbackSummary, summarizeWithFallback, validateSummaryFormat } from "./summarize";
import { buildYouTubePromptContext } from "@/lib/youtube/transcript";

const mockedGenerateWithGemini = vi.mocked(generateWithGemini);
const mockedBuildYouTubePromptContext = vi.mocked(buildYouTubePromptContext);

describe("buildFallbackSummary", () => {
  it("creates valid format for text input", () => {
    const summary = buildFallbackSummary(
      "text",
      "첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다.",
      "GEMINI_REQUEST_FAILED",
    );

    expect(validateSummaryFormat(summary)).toBe(true);
    expect(summary).toContain("원인 코드: GEMINI_REQUEST_FAILED");
  });

  it("creates valid format for youtube input", () => {
    const summary = buildFallbackSummary(
      "youtube",
      "https://youtu.be/twsx6DvIvBE",
      "GEMINI_TIMEOUT",
    );

    expect(validateSummaryFormat(summary)).toBe(true);
    expect(summary).toContain("영상 ID twsx6DvIvBE");
  });
});

describe("summarizeWithFallback", () => {
  beforeEach(() => {
    mockedGenerateWithGemini.mockReset();
    mockedBuildYouTubePromptContext.mockReset();
  });

  it("uses gemini result when response format is valid", async () => {
    mockedGenerateWithGemini.mockResolvedValue(
      [
        "TL;DR",
        "- 핵심 1",
        "- 핵심 2",
        "- 핵심 3",
        "",
        "전체 요약",
        "정상 요약 결과",
      ].join("\n"),
    );

    const result = await summarizeWithFallback({
      sourceType: "text",
      content: "입력 텍스트입니다. 충분한 길이의 문장을 제공합니다.",
      requestId: "test-request-id",
    });

    expect(result.usedFallback).toBe(false);
    expect(result.fallbackReasonCode).toBeUndefined();
    expect(result.summaryText).toContain("정상 요약 결과");
  });

  it("falls back when gemini throws app error", async () => {
    mockedGenerateWithGemini.mockRejectedValue(
      new AppError("rate limit", "GEMINI_REQUEST_FAILED", 502),
    );

    const result = await summarizeWithFallback({
      sourceType: "text",
      content: "이 문장은 폴백 테스트를 위한 본문입니다. 두 번째 문장입니다. 세 번째 문장입니다.",
      requestId: "test-request-id",
    });

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReasonCode).toBe("GEMINI_REQUEST_FAILED");
    expect(validateSummaryFormat(result.summaryText)).toBe(true);
  });

  it("uses transcript extractive fallback for youtube when gemini fails", async () => {
    mockedBuildYouTubePromptContext.mockResolvedValue({
      promptInput: [
        "YouTube URL: https://www.youtube.com/watch?v=abc123def45",
        "영상 ID: abc123def45",
        "영상 제목: 테스트 영상",
        "자막 언어: ko",
        "",
        "영상 자막 텍스트:",
        "첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다.",
      ].join("\n"),
      transcript: "첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다.",
      normalizedUrl: "https://www.youtube.com/watch?v=abc123def45",
      videoId: "abc123def45",
      title: "테스트 영상",
      languageCode: "ko",
    });
    mockedGenerateWithGemini.mockRejectedValue(
      new AppError("rate limit", "GEMINI_REQUEST_FAILED", 502),
    );

    const result = await summarizeWithFallback({
      sourceType: "youtube",
      content: "https://www.youtube.com/watch?v=abc123def45",
      requestId: "test-request-id",
    });

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackKind).toBe("transcript_extractive");
    expect(result.fallbackReasonCode).toBe("GEMINI_REQUEST_FAILED");
    expect(result.summaryText).toContain("외부 모델 응답 제한으로 자막 기반 추출 요약을 제공합니다.");
    expect(validateSummaryFormat(result.summaryText)).toBe(true);
  });

  it("uses generic fallback for youtube when transcript context fails", async () => {
    mockedBuildYouTubePromptContext.mockRejectedValue(
      new AppError("blocked", "YOUTUBE_TRANSCRIPT_BLOCKED", 502),
    );

    const result = await summarizeWithFallback({
      sourceType: "youtube",
      content: "https://www.youtube.com/watch?v=abc123def45",
      requestId: "test-request-id",
    });

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackKind).toBe("generic");
    expect(result.fallbackReasonCode).toBe("YOUTUBE_TRANSCRIPT_BLOCKED");
    expect(result.summaryText).toContain("영상 ID abc123def45");
    expect(validateSummaryFormat(result.summaryText)).toBe(true);
  });
});
