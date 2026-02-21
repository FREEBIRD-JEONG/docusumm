import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors/app-error";

vi.mock("@/db/repositories/summary-repository", () => ({
  claimSummaryJobs: vi.fn(),
  completeSummaryJob: vi.fn(),
  failSummaryJob: vi.fn(),
  getSummaryOwnerEmail: vi.fn(),
  markSummaryProcessing: vi.fn(),
}));

vi.mock("@/db/repositories/user-repository", () => ({
  restoreUserCredit: vi.fn(),
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
import { restoreUserCredit } from "@/db/repositories/user-repository";
import { summarizeWithFallback } from "@/lib/gemini/summarize";
import { sendSummaryCompletedEmail } from "@/lib/resend/client";

import { POST } from "./route";

const mockedClaimSummaryJobs = vi.mocked(claimSummaryJobs);
const mockedCompleteSummaryJob = vi.mocked(completeSummaryJob);
const mockedFailSummaryJob = vi.mocked(failSummaryJob);
const mockedGetSummaryOwnerEmail = vi.mocked(getSummaryOwnerEmail);
const mockedMarkSummaryProcessing = vi.mocked(markSummaryProcessing);
const mockedRestoreUserCredit = vi.mocked(restoreUserCredit);
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
    mockedRestoreUserCredit.mockReset();
    mockedSummarizeWithFallback.mockReset();
    mockedSendSummaryCompletedEmail.mockReset();

    mockedRestoreUserCredit.mockResolvedValue(3);
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

  it("completes job and sends email", async () => {
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
    });
    mockedCompleteSummaryJob.mockResolvedValue(true);
    mockedGetSummaryOwnerEmail.mockResolvedValue("user@example.com");
    mockedSendSummaryCompletedEmail.mockResolvedValue({ status: "sent" });

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedCompleteSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedFailSummaryJob).not.toHaveBeenCalled();
    expect(mockedRestoreUserCredit).not.toHaveBeenCalled();

    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(1);
    expect(body.failed).toBe(0);
  });

  it("refunds credit on terminal failure", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-2",
        summaryId: "summary-2",
        attemptCount: 3,
        sourceType: "youtube",
        originalContent: "https://www.youtube.com/watch?v=abc123def45",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(true);
    mockedSummarizeWithFallback.mockRejectedValue(
      new AppError("blocked", "YOUTUBE_TRANSCRIPT_BLOCKED", 502),
    );
    mockedFailSummaryJob.mockResolvedValue({
      terminal: true,
      canceledByUser: false,
      userId: "user-1",
    });

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedFailSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedRestoreUserCredit).toHaveBeenCalledWith("user-1");

    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(0);
    expect(body.failed).toBe(1);
  });

  it("does not refund credit when failure will be retried", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-3",
        summaryId: "summary-3",
        attemptCount: 1,
        sourceType: "youtube",
        originalContent: "https://www.youtube.com/watch?v=abc123def45",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(true);
    mockedSummarizeWithFallback.mockRejectedValue(
      new AppError("temporary", "GEMINI_REQUEST_FAILED", 502),
    );
    mockedFailSummaryJob.mockResolvedValue({
      terminal: false,
      canceledByUser: false,
      userId: "user-1",
    });

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedFailSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedRestoreUserCredit).not.toHaveBeenCalled();
  });

  it("keeps remote worker timeout failures retryable without refund", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-3b",
        summaryId: "summary-3b",
        attemptCount: 1,
        sourceType: "youtube",
        originalContent: "https://www.youtube.com/watch?v=abc123def45",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(true);
    mockedSummarizeWithFallback.mockRejectedValue(
      new AppError("timeout", "TRANSCRIPT_WORKER_TIMEOUT", 504),
    );
    mockedFailSummaryJob.mockResolvedValue({
      terminal: false,
      canceledByUser: false,
      userId: "user-1",
    });

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedFailSummaryJob).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 3,
      }),
    );
    expect(mockedRestoreUserCredit).not.toHaveBeenCalled();
  });

  it("does not refund credit when summary was canceled by user", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-4",
        summaryId: "summary-4",
        attemptCount: 2,
        sourceType: "text",
        originalContent: "요약 대상 텍스트입니다. 충분히 긴 테스트 콘텐츠를 사용합니다.",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(true);
    mockedSummarizeWithFallback.mockRejectedValue(
      new AppError("canceled", "SUMMARY_CANCELED", 409),
    );
    mockedFailSummaryJob.mockResolvedValue({
      terminal: true,
      canceledByUser: true,
      userId: "user-1",
    });

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedFailSummaryJob).toHaveBeenCalledTimes(1);
    expect(mockedRestoreUserCredit).not.toHaveBeenCalled();
  });

  it("does not send email when job is skipped after cancellation", async () => {
    mockedClaimSummaryJobs.mockResolvedValue([
      {
        jobId: "job-5",
        summaryId: "summary-5",
        attemptCount: 1,
        sourceType: "text",
        originalContent: "요약 대상 텍스트입니다. 충분히 긴 테스트 콘텐츠를 사용합니다.",
      },
    ]);
    mockedMarkSummaryProcessing.mockResolvedValue(false);

    const response = await POST(buildWorkerRequest());

    expect(response.status).toBe(200);
    expect(mockedSendSummaryCompletedEmail).not.toHaveBeenCalled();
    expect(mockedRestoreUserCredit).not.toHaveBeenCalled();
    const body = (await response.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(0);
    expect(body.failed).toBe(1);
  });
});
