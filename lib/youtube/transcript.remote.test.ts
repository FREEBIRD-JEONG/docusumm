import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors/app-error";

vi.mock("./remote-transcript-client", () => ({
  fetchRemoteYouTubeTranscript: vi.fn(),
}));

import { fetchRemoteYouTubeTranscript } from "./remote-transcript-client";
import { buildYouTubePromptContext } from "./transcript";

const mockedFetchRemoteYouTubeTranscript = vi.mocked(fetchRemoteYouTubeTranscript);

describe("buildYouTubePromptContext remote-first flow", () => {
  beforeEach(() => {
    mockedFetchRemoteYouTubeTranscript.mockReset();
    process.env.TRANSCRIPT_REMOTE_FALLBACK_LOCAL = "0";
    process.env.TRANSCRIPT_WORKER_URL = "https://worker.example.com";
  });

  afterEach(() => {
    delete process.env.TRANSCRIPT_REMOTE_FALLBACK_LOCAL;
    delete process.env.TRANSCRIPT_WORKER_URL;
  });

  it("returns prompt context from remote transcript payload", async () => {
    mockedFetchRemoteYouTubeTranscript.mockResolvedValue({
      transcript: "첫 문장입니다. 둘째 문장입니다.",
      videoId: "abc123def45",
      title: "원격 자막 제목",
      languageCode: "ko",
      provider: "yt-dlp",
      durationMs: 523,
    });

    const context = await buildYouTubePromptContext("https://www.youtube.com/watch?v=abc123def45");

    expect(context.videoId).toBe("abc123def45");
    expect(context.title).toBe("원격 자막 제목");
    expect(context.languageCode).toBe("ko");
    expect(context.transcript).toContain("첫 문장입니다.");
    expect(context.promptInput).toContain("영상 자막 텍스트:");
    expect(mockedFetchRemoteYouTubeTranscript).toHaveBeenCalledTimes(1);
  });

  it("propagates YOUTUBE_TRANSCRIPT_BLOCKED when remote worker reports blocked", async () => {
    mockedFetchRemoteYouTubeTranscript.mockRejectedValue(
      new AppError("blocked", "YOUTUBE_TRANSCRIPT_BLOCKED", 502),
    );

    await expect(
      buildYouTubePromptContext("https://www.youtube.com/watch?v=abc123def45"),
    ).rejects.toMatchObject({
      code: "YOUTUBE_TRANSCRIPT_BLOCKED",
    });
  });

  it("propagates YOUTUBE_TRANSCRIPT_UNAVAILABLE when remote worker reports unavailable", async () => {
    mockedFetchRemoteYouTubeTranscript.mockRejectedValue(
      new AppError("unavailable", "YOUTUBE_TRANSCRIPT_UNAVAILABLE", 422),
    );

    await expect(
      buildYouTubePromptContext("https://www.youtube.com/watch?v=abc123def45"),
    ).rejects.toMatchObject({
      code: "YOUTUBE_TRANSCRIPT_UNAVAILABLE",
    });
  });
});
