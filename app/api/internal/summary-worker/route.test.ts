import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/repositories/summary-repository", () => ({
  claimSummaryJobs: vi.fn(),
  completeSummaryJob: vi.fn(),
  failSummaryJob: vi.fn(),
  getSummaryOwnerEmail: vi.fn(),
  markSummaryProcessing: vi.fn(),
}));

vi.mock("@/lib/gemini/summarize", () => ({
  summarizeWithFallback: vi.fn(),
}));

vi.mock("@/lib/resend/client", () => ({
  sendSummaryCompletedEmail: vi.fn(),
}));

import {
  claimSummaryJobs,
  completeSummaryJob,
  failSummaryJob,
  getSummaryOwnerEmail,
  markSummaryProcessing,
} from "@/db/repositories/summary-repository";
import { summarizeWithFallback } from "@/lib/gemini/summarize";
import { sendSummaryCompletedEmail } from "@/lib/resend/client";

import { POST } from "./route";

const mockedClaimSummaryJobs = vi.mocked(claimSummaryJobs);
const mockedCompleteSummaryJob = vi.mocked(completeSummaryJob);
const mockedFailSummaryJob = vi.mocked(failSummaryJob);
const mockedGetSummaryOwnerEmail = vi.mocked(getSummaryOwnerEmail);
const mockedMarkSummaryProcessing = vi.mocked(markSummaryProcessing);
const mockedSummarizeWithFallback = vi.mocked(summarizeWithFallback);
const mockedSendSummaryCompletedEmail = vi.mocked(sendSummaryCompletedEmail);

function buildWorkerRequest(headers: HeadersInit = { "x-worker-secret": "worker-secret" }) {
  return new Request("http://localhost/api/internal/summary-worker", {
    method: "POST",
    headers,
  });
}

describe("summary worker route", () => {
  beforeEach(() => {
    mockedClaimSummaryJobs.mockReset();
    mockedCompleteSummaryJob.mockReset();
    mockedFailSummaryJob.mockReset();
    mockedGetSummaryOwnerEmail.mockReset();
    mockedMarkSummaryProcessing.mockReset();
    mockedSummarizeWithFallback.mockReset();
    mockedSendSummaryCompletedEmail.mockReset();

    process.env.INTERNAL_WORKER_SECRET = "worker-secret";
  });

  it("returns 401 when auth is configured but request header is missing", async () => {
    const response = await POST(buildWorkerRequest({}));

    expect(response.status).toBe(401);
    expect(mockedClaimSummaryJobs).not.toHaveBeenCalled();
  });

  it("allows request without headers when auth secrets are not configured", async () => {
    delete process.env.INTERNAL_WORKER_SECRET;
    delete process.env.CRON_SECRET;
    mockedClaimSummaryJobs.mockResolvedValue([]);

    const response = await POST(buildWorkerRequest({}));

    expect(response.status).toBe(200);
    expect(mockedClaimSummaryJobs).toHaveBeenCalledTimes(1);
  });

  it("completes youtube job when generic fallback is used", async () => {
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
      fallbackReasonCode: "GEMINI_REQUEST_FAILED",
      fallbackKind: "generic",
    });
    mockedCompleteSummaryJob.mockResolvedValue(true);
    mockedGetSummaryOwnerEmail.mockResolvedValue("user@example.com");
    mockedSendSummaryCompletedEmail.mockResolvedValue({ status: "sent" });

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedCompleteSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedFailSummaryJob).not.toHaveBeenCalled();

    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(1);
    expect(body.failed).toBe(0);
  });

  it("completes youtube job when generic fallback reason is YOUTUBE_TRANSCRIPT_BLOCKED", async () => {
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
      fallbackReasonCode: "YOUTUBE_TRANSCRIPT_BLOCKED",
      fallbackKind: "generic",
    });
    mockedCompleteSummaryJob.mockResolvedValue(true);
    mockedGetSummaryOwnerEmail.mockResolvedValue("user@example.com");
    mockedSendSummaryCompletedEmail.mockResolvedValue({ status: "sent" });

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedCompleteSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedFailSummaryJob).not.toHaveBeenCalled();

    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(1);
    expect(body.failed).toBe(0);
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
    mockedGetSummaryOwnerEmail.mockResolvedValue("user@example.com");
    mockedSendSummaryCompletedEmail.mockResolvedValue({ status: "sent" });

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedCompleteSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedGetSummaryOwnerEmail).toHaveBeenCalledWith("summary-1");
    expect(mockedSendSummaryCompletedEmail).toHaveBeenCalledWith({
      toEmail: "user@example.com",
      summaryId: "summary-1",
      summaryText: "TL;DR\n- point1\n- point2\n- point3\n\n전체 요약\nbody",
      originalContent: "https://www.youtube.com/watch?v=abc123def45",
      requestUrl: "http://localhost/api/internal/summary-worker",
    });
    expect(mockedFailSummaryJob).not.toHaveBeenCalled();

    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(1);
    expect(body.failed).toBe(0);
  });

  it("keeps summary completed when email sending fails", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-2",
        summaryId: "summary-2",
        attemptCount: 1,
        sourceType: "text",
        originalContent: "요약 대상 텍스트입니다. 충분히 긴 테스트 콘텐츠를 사용합니다.",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(true);
    mockedSummarizeWithFallback.mockResolvedValue({
      summaryText: "TL;DR\n- a\n- b\n- c\n\n전체 요약\nbody",
      usedFallback: false,
      fallbackReasonCode: undefined,
      fallbackKind: undefined,
    });
    mockedCompleteSummaryJob.mockResolvedValue(true);
    mockedGetSummaryOwnerEmail.mockResolvedValue("user@example.com");
    mockedSendSummaryCompletedEmail.mockRejectedValue(new Error("[RESEND_SEND_FAILED] network error"));

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedCompleteSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedFailSummaryJob).not.toHaveBeenCalled();
    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(1);
    expect(body.failed).toBe(0);
  });

  it("does not send email when job is skipped after cancellation", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-3",
        summaryId: "summary-3",
        attemptCount: 1,
        sourceType: "text",
        originalContent: "요약 대상 텍스트입니다. 충분히 긴 테스트 콘텐츠를 사용합니다.",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(false);

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedSendSummaryCompletedEmail).not.toHaveBeenCalled();
    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(0);
    expect(body.failed).toBe(1);
  });
});
