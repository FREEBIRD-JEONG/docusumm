import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../errors/app-error";

vi.mock("./client", () => ({
  generateWithGemini: vi.fn(),
}));
vi.mock("@/lib/youtube/transcript", () => ({
  buildYouTubePromptContext: vi.fn(),
}));

import { generateWithGemini } from "./client";
import { summarizeWithFallback, validateSummaryFormat } from "./summarize";
import { buildYouTubePromptContext } from "@/lib/youtube/transcript";

const mockedGenerateWithGemini = vi.mocked(generateWithGemini);
const mockedBuildYouTubePromptContext = vi.mocked(buildYouTubePromptContext);

describe("validateSummaryFormat", () => {
  it("accepts valid TL;DR + full summary format", () => {
    const summary = [
      "TL;DR",
      "- 핵심 1",
      "- 핵심 2",
      "- 핵심 3",
      "",
      "전체 요약",
      "정상 요약 결과",
    ].join("\n");

    expect(validateSummaryFormat(summary)).toBe(true);
  });
});

describe("summarizeWithFallback", () => {
  beforeEach(() => {
    mockedGenerateWithGemini.mockReset();
    mockedBuildYouTubePromptContext.mockReset();
  });

  it("returns summary when text request succeeds", async () => {
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

    expect(result.summaryText).toContain("정상 요약 결과");
  });

  it("throws original app error when text request fails", async () => {
    mockedGenerateWithGemini.mockRejectedValue(
      new AppError("rate limit", "GEMINI_REQUEST_FAILED", 502),
    );

    await expect(
      summarizeWithFallback({
        sourceType: "text",
        content: "이 문장은 오류 전파 테스트를 위한 본문입니다. 두 번째 문장입니다. 세 번째 문장입니다.",
        requestId: "test-request-id",
      }),
    ).rejects.toMatchObject({
      code: "GEMINI_REQUEST_FAILED",
    });
  });

  it("throws transcript blocked error when youtube transcript context fails", async () => {
    mockedBuildYouTubePromptContext.mockRejectedValue(
      new AppError("blocked", "YOUTUBE_TRANSCRIPT_BLOCKED", 502),
    );

    await expect(
      summarizeWithFallback({
        sourceType: "youtube",
        content: "https://www.youtube.com/watch?v=abc123def45",
        requestId: "test-request-id",
      }),
    ).rejects.toMatchObject({
      code: "YOUTUBE_TRANSCRIPT_BLOCKED",
    });
  });

  it("throws gemini request error for youtube when model call fails", async () => {
    mockedBuildYouTubePromptContext.mockResolvedValue({
      promptInput: [
        "YouTube URL: https://www.youtube.com/watch?v=abc123def45",
        "영상 ID: abc123def45",
        "영상 제목: 테스트 영상",
        "자막 언어: ko",
        "",
        "영상 자막 텍스트:",
        "첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다.",
      ].join("\n"),
      transcript: "첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다.",
      normalizedUrl: "https://www.youtube.com/watch?v=abc123def45",
      videoId: "abc123def45",
      title: "테스트 영상",
      languageCode: "ko",
    });
    mockedGenerateWithGemini.mockRejectedValue(
      new AppError("rate limit", "GEMINI_REQUEST_FAILED", 502),
    );

    await expect(
      summarizeWithFallback({
        sourceType: "youtube",
        content: "https://www.youtube.com/watch?v=abc123def45",
        requestId: "test-request-id",
      }),
    ).rejects.toMatchObject({
      code: "GEMINI_REQUEST_FAILED",
    });
  });
});
