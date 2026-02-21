import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SummaryRecord } from "@/types/summary";

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

vi.mock("@/db/repositories/summary-repository", () => ({
  createSummary: vi.fn(),
  enqueueSummaryJob: vi.fn(),
  claimSummaryJobs: vi.fn(),
  markSummaryProcessing: vi.fn(),
  completeSummaryJob: vi.fn(),
  failSummaryJob: vi.fn(),
  getSummaryById: vi.fn(),
  getSummaryOwnerEmail: vi.fn(),
}));

vi.mock("@/db/repositories/user-repository", () => ({
  consumeUserCredit: vi.fn(),
  restoreUserCredit: vi.fn(),
}));

vi.mock("@/lib/gemini/summarize", () => ({
  summarizeWithFallback: vi.fn(),
}));

vi.mock("@/lib/resend/client", () => ({
  sendSummaryCompletedEmail: vi.fn(),
}));

import { AppError } from "@/lib/errors/app-error";
import { resolveApiUser } from "@/lib/auth/api-user";
import {
  claimSummaryJobs,
  completeSummaryJob,
  createSummary,
  enqueueSummaryJob,
  failSummaryJob,
  getSummaryById,
  getSummaryOwnerEmail,
  markSummaryProcessing,
} from "@/db/repositories/summary-repository";
import { consumeUserCredit, restoreUserCredit } from "@/db/repositories/user-repository";
import { summarizeWithFallback } from "@/lib/gemini/summarize";
import { sendSummaryCompletedEmail } from "@/lib/resend/client";

import { POST as createSummaryPost } from "@/app/api/summary/route";
import { POST as workerPost } from "@/app/api/internal/summary-worker/route";
import { GET as getSummaryRoute } from "@/app/api/summaries/[id]/route";

const mockedResolveApiUser = vi.mocked(resolveApiUser);
const mockedCreateSummary = vi.mocked(createSummary);
const mockedEnqueueSummaryJob = vi.mocked(enqueueSummaryJob);
const mockedClaimSummaryJobs = vi.mocked(claimSummaryJobs);
const mockedMarkSummaryProcessing = vi.mocked(markSummaryProcessing);
const mockedCompleteSummaryJob = vi.mocked(completeSummaryJob);
const mockedFailSummaryJob = vi.mocked(failSummaryJob);
const mockedGetSummaryById = vi.mocked(getSummaryById);
const mockedGetSummaryOwnerEmail = vi.mocked(getSummaryOwnerEmail);
const mockedConsumeUserCredit = vi.mocked(consumeUserCredit);
const mockedRestoreUserCredit = vi.mocked(restoreUserCredit);
const mockedSummarizeWithFallback = vi.mocked(summarizeWithFallback);
const mockedSendSummaryCompletedEmail = vi.mocked(sendSummaryCompletedEmail);

type JobState = {
  id: string;
  summaryId: string;
  status: "queued" | "processing" | "failed" | "completed";
  attemptCount: number;
};

describe("YouTube failure refund integration", () => {
  const userId = "user-youtube-failure";
  let credits = 3;
  const summaries = new Map<string, SummaryRecord>();
  const jobs = new Map<string, JobState>();

  beforeEach(() => {
    mockedResolveApiUser.mockReset();
    mockedCreateSummary.mockReset();
    mockedEnqueueSummaryJob.mockReset();
    mockedClaimSummaryJobs.mockReset();
    mockedMarkSummaryProcessing.mockReset();
    mockedCompleteSummaryJob.mockReset();
    mockedFailSummaryJob.mockReset();
    mockedGetSummaryById.mockReset();
    mockedGetSummaryOwnerEmail.mockReset();
    mockedConsumeUserCredit.mockReset();
    mockedRestoreUserCredit.mockReset();
    mockedSummarizeWithFallback.mockReset();
    mockedSendSummaryCompletedEmail.mockReset();

    credits = 3;
    summaries.clear();
    jobs.clear();

    process.env.AUTO_TRIGGER_WORKER_ON_SUMMARY_CREATE = "false";
    process.env.INTERNAL_WORKER_SECRET = "worker-secret";

    mockedResolveApiUser.mockResolvedValue({
      userId,
      email: "user@example.com",
      errorResponse: null,
    });

    mockedConsumeUserCredit.mockImplementation(async () => {
      if (credits <= 0) {
        return null;
      }
      credits -= 1;
      return credits;
    });

    mockedRestoreUserCredit.mockImplementation(async () => {
      credits += 1;
      return credits;
    });

    mockedCreateSummary.mockImplementation(async ({ sourceType, originalContent, userId: ownerId }) => {
      const id = `sum-${summaries.size + 1}`;
      const now = new Date().toISOString();
      const record: SummaryRecord = {
        id,
        userId: ownerId,
        sourceType,
        originalContent,
        summaryText: null,
        status: "pending",
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
      summaries.set(id, record);
      return record;
    });

    mockedEnqueueSummaryJob.mockImplementation(async (summaryId) => {
      const jobId = `job-${jobs.size + 1}`;
      jobs.set(jobId, {
        id: jobId,
        summaryId,
        status: "queued",
        attemptCount: 0,
      });
    });

    mockedClaimSummaryJobs.mockImplementation(async () => {
      const queued = Array.from(jobs.values()).find((item) => item.status === "queued");
      if (!queued) {
        return [];
      }
      queued.status = "processing";
      queued.attemptCount += 1;
      jobs.set(queued.id, queued);
      const summary = summaries.get(queued.summaryId);
      if (!summary) {
        return [];
      }
      return [
        {
          jobId: queued.id,
          summaryId: queued.summaryId,
          attemptCount: queued.attemptCount,
          sourceType: summary.sourceType,
          originalContent: summary.originalContent,
        },
      ];
    });

    mockedMarkSummaryProcessing.mockImplementation(async (summaryId) => {
      const summary = summaries.get(summaryId);
      if (!summary || summary.status !== "pending") {
        return false;
      }
      summary.status = "processing";
      summary.updatedAt = new Date().toISOString();
      summaries.set(summaryId, summary);
      return true;
    });

    mockedCompleteSummaryJob.mockResolvedValue(false);

    mockedFailSummaryJob.mockImplementation(async ({ summaryId, jobId, errorMessage }) => {
      const summary = summaries.get(summaryId);
      if (summary) {
        summary.status = "failed";
        summary.summaryText = null;
        summary.errorMessage = errorMessage;
        summary.updatedAt = new Date().toISOString();
        summaries.set(summaryId, summary);
      }
      const job = jobs.get(jobId);
      if (job) {
        job.status = "failed";
        jobs.set(jobId, job);
      }
      return {
        terminal: true,
        canceledByUser: false,
        userId: summary?.userId ?? null,
      };
    });

    mockedGetSummaryById.mockImplementation(async (summaryId, ownerId) => {
      const summary = summaries.get(summaryId);
      if (!summary || summary.userId !== ownerId) {
        return null;
      }
      return summary;
    });

    mockedGetSummaryOwnerEmail.mockResolvedValue("user@example.com");
    mockedSendSummaryCompletedEmail.mockResolvedValue({ status: "sent" });

    mockedSummarizeWithFallback.mockRejectedValue(
      new AppError("blocked", "YOUTUBE_TRANSCRIPT_BLOCKED", 502),
    );
  });

  it("marks youtube summary failed, restores credit, and keeps summary text empty", async () => {
    const createResponse = await createSummaryPost(
      new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "youtube",
          content: "https://www.youtube.com/watch?v=yK5iZfn6NV4",
        }),
      }),
    );

    expect(createResponse.status).toBe(202);
    const created = (await createResponse.json()) as { id: string; remainingCredits: number };
    expect(created.remainingCredits).toBe(2);

    const workerResponse = await workerPost(
      new Request("http://localhost/api/internal/summary-worker", {
        method: "POST",
        headers: {
          "x-worker-secret": "worker-secret",
        },
      }),
    );

    expect(workerResponse.status).toBe(200);
    const workerData = (await workerResponse.json()) as { completed: number; failed: number };
    expect(workerData.completed).toBe(0);
    expect(workerData.failed).toBe(1);

    const summaryResponse = await getSummaryRoute(
      new Request(`http://localhost/api/summaries/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(summaryResponse.status).toBe(200);
    const summaryData = (await summaryResponse.json()) as {
      record: SummaryRecord;
      summary: string | null;
      status: SummaryRecord["status"];
    };

    expect(summaryData.status).toBe("failed");
    expect(summaryData.summary).toBeNull();
    expect(summaryData.record.summaryText).toBeNull();
    expect(summaryData.record.errorMessage).toContain("[YOUTUBE_TRANSCRIPT_BLOCKED]");
    expect(credits).toBe(3);
    expect(mockedRestoreUserCredit).toHaveBeenCalledWith(userId);
    expect(mockedSendSummaryCompletedEmail).not.toHaveBeenCalled();
  });
});
