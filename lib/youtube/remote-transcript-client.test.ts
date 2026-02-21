import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRemoteYouTubeTranscript } from "./remote-transcript-client";

describe("fetchRemoteYouTubeTranscript", () => {
  beforeEach(() => {
    process.env.TRANSCRIPT_WORKER_URL = "https://worker.example.com";
    process.env.TRANSCRIPT_WORKER_KEY = "worker-secret";
    process.env.TRANSCRIPT_WORKER_TIMEOUT_MS = "45000";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.TRANSCRIPT_WORKER_URL;
    delete process.env.TRANSCRIPT_WORKER_KEY;
    delete process.env.TRANSCRIPT_WORKER_TIMEOUT_MS;
  });

  it("parses successful response payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          transcript: "첫 문장. 둘째 문장.",
          videoId: "abc123def45",
          title: "테스트 영상",
          languageCode: "ko",
          provider: "yt-dlp",
          durationMs: 812,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRemoteYouTubeTranscript({
      youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
      requestId: "req-1",
    });

    expect(result).toEqual({
      transcript: "첫 문장. 둘째 문장.",
      videoId: "abc123def45",
      title: "테스트 영상",
      languageCode: "ko",
      provider: "yt-dlp",
      durationMs: 812,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example.com/v1/youtube-transcript",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-transcript-worker-key": "worker-secret",
        }),
      }),
    );
  });

  it("maps 401/403 responses to TRANSCRIPT_WORKER_UNAVAILABLE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "unauthorized",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRemoteYouTubeTranscript({
        youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
        requestId: "req-2",
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPT_WORKER_UNAVAILABLE",
    });
  });

  it("maps 5xx retryable failures to TRANSCRIPT_WORKER_UNAVAILABLE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "TEMPORARY_OUTAGE",
          message: "worker busy",
          retryable: true,
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRemoteYouTubeTranscript({
        youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
        requestId: "req-3",
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPT_WORKER_UNAVAILABLE",
    });
  });

  it("maps abort errors to TRANSCRIPT_WORKER_TIMEOUT", async () => {
    process.env.TRANSCRIPT_WORKER_TIMEOUT_MS = "1";
    const abortedError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = vi.fn().mockRejectedValue(abortedError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRemoteYouTubeTranscript({
        youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
        requestId: "req-4",
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPT_WORKER_TIMEOUT",
    });
  });

  it("passes through standardized youtube error codes from remote worker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "YOUTUBE_TRANSCRIPT_BLOCKED",
          message: "blocked by youtube",
          retryable: false,
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRemoteYouTubeTranscript({
        youtubeUrl: "https://www.youtube.com/watch?v=abc123def45",
        requestId: "req-5",
      }),
    ).rejects.toMatchObject({
      code: "YOUTUBE_TRANSCRIPT_BLOCKED",
    });
  });
});

