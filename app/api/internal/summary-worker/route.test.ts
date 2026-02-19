import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/repositories/summary-repository", () => ({
  claimSummaryJobs: vi.fn(),
  completeSummaryJob: vi.fn(),
  failSummaryJob: vi.fn(),
  markSummaryProcessing: vi.fn(),
}));

vi.mock("@/lib/gemini/summarize", () => ({
  summarizeWithFallback: vi.fn(),
}));

import {
  claimSummaryJobs,
  completeSummaryJob,
  failSummaryJob,
  markSummaryProcessing,
} from "@/db/repositories/summary-repository";
import { summarizeWithFallback } from "@/lib/gemini/summarize";

import { POST } from "./route";

const mockedClaimSummaryJobs = vi.mocked(claimSummaryJobs);
const mockedCompleteSummaryJob = vi.mocked(completeSummaryJob);
const mockedFailSummaryJob = vi.mocked(failSummaryJob);
const mockedMarkSummaryProcessing = vi.mocked(markSummaryProcessing);
const mockedSummarizeWithFallback = vi.mocked(summarizeWithFallback);

function buildWorkerRequest() {
  return new Request("http://localhost/api/internal/summary-worker", {
    method: "POST",
    headers: { "x-worker-secret": "worker-secret" },
  });
}

describe("summary worker route", () => {
  beforeEach(() => {
    mockedClaimSummaryJobs.mockReset();
    mockedCompleteSummaryJob.mockReset();
    mockedFailSummaryJob.mockReset();
    mockedMarkSummaryProcessing.mockReset();
    mockedSummarizeWithFallback.mockReset();

    process.env.INTERNAL_WORKER_SECRET = "worker-secret";
    delete process.env.CRON_SECRET;
  });

  it("fails youtube job when generic fallback is used", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-1",
        summaryId: "summary-1",
        attemptCount: 1,
        sourceType: "youtube",
        originalContent: "https://www.youtube.com/watch?v=abc123def45",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(true);
    mockedSummarizeWithFallback.mockResolvedValue({
      summaryText: "fallback text",
      usedFallback: true,
      fallbackReasonCode: "GEMINI_REQUEST_FAILED",
      fallbackKind: "generic",
    });
    mockedFailSummaryJob.mockResolvedValue(undefined);

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedFailSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedCompleteSummaryJob).not.toHaveBeenCalled();

    const failInput = mockedFailSummaryJob.mock.calls[0]?.[0];
    expect(failInput?.errorMessage).toContain("[GEMINI_REQUEST_FAILED]");
    expect(failInput?.errorMessage).toContain("429");

    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(0);
    expect(body.failed).toBe(1);
  });

  it("accepts youtube job when transcript_extractive fallback is used", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-1",
        summaryId: "summary-1",
        attemptCount: 1,
        sourceType: "youtube",
        originalContent: "https://www.youtube.com/watch?v=abc123def45",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(true);
    mockedSummarizeWithFallback.mockResolvedValue({
      summaryText: "TL;DR\n- point1\n- point2\n- point3\n\n전체 요약\nbody",
      usedFallback: true,
      fallbackReasonCode: "GEMINI_OUTPUT_INVALID",
      fallbackKind: "transcript_extractive",
    });
    mockedCompleteSummaryJob.mockResolvedValue(true);

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedCompleteSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedFailSummaryJob).not.toHaveBeenCalled();

    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(1);
    expect(body.failed).toBe(0);
  });
});
