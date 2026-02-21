import { NextResponse } from "next/server";

import {
  claimSummaryJobs,
  completeSummaryJob,
  failSummaryJob,
  getSummaryOwnerEmail,
  markSummaryProcessing,
} from "@/db/repositories/summary-repository";
import { restoreUserCredit } from "@/db/repositories/user-repository";
import { AppError } from "@/lib/errors/app-error";
import { summarizeWithFallback } from "@/lib/gemini/summarize";
import { sendSummaryCompletedEmail } from "@/lib/resend/client";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;
const RETRYABLE_ERROR_CODES = new Set([
  "GEMINI_REQUEST_FAILED",
  "GEMINI_TIMEOUT",
  "GEMINI_UNKNOWN_ERROR",
  "GEMINI_EMPTY_RESPONSE",
  "GEMINI_OUTPUT_INVALID",
]);

function extractErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }

  if (error instanceof Error) {
    const match = error.message.match(/\[([A-Z0-9_]+)\]/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "GEMINI_UNKNOWN_ERROR";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "요약 작업 처리 중 알 수 없는 오류";
}

function avgDurationMs(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((acc, cur) => acc + cur, 0);
  return Math.round(total / values.length);
}

function resolveMaxAttempts(errorCode: string, attemptCount: number): number {
  return RETRYABLE_ERROR_CODES.has(errorCode) ? MAX_ATTEMPTS : attemptCount;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized worker request" }, { status: 401 });
}

async function runWorker(request: Request) {
  const workerSecret = process.env.INTERNAL_WORKER_SECRET?.trim();
  const requestSecret = request.headers.get("x-worker-secret");
  const isAuthConfigured = Boolean(workerSecret);
  const isWorkerHeaderValid = Boolean(workerSecret && requestSecret === workerSecret);

  if (isAuthConfigured && !isWorkerHeaderValid) {
    return unauthorized();
  }

  try {
    const jobs = await claimSummaryJobs(BATCH_SIZE);
    const jobDurations: number[] = [];
    const failureCodes: Record<string, number> = {};
    let completed = 0;
    let failed = 0;
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

    for (const job of jobs) {
      const startedAt = Date.now();
      const requestId = `worker-${job.jobId}-${job.attemptCount}`;
      const markedProcessing = await markSummaryProcessing(job.summaryId);
      if (!markedProcessing) {
        const durationMs = Date.now() - startedAt;
        jobDurations.push(durationMs);
        failureCodes.SUMMARY_CANCELED = (failureCodes.SUMMARY_CANCELED ?? 0) + 1;
        console.info("[summary-worker] job skipped", {
          requestId,
          summaryId: job.summaryId,
          durationMs,
          model,
          reason: "summary-not-pending",
        });
        failed += 1;
        continue;
      }
      try {
        const result = await summarizeWithFallback({
          sourceType: job.sourceType,
          content: job.originalContent,
          requestId,
        });

        const summaryText = result.summaryText;

        const completedSuccessfully = await completeSummaryJob(job.summaryId, job.jobId, summaryText);
        const durationMs = Date.now() - startedAt;
        jobDurations.push(durationMs);
        if (!completedSuccessfully) {
          failureCodes.SUMMARY_CANCELED = (failureCodes.SUMMARY_CANCELED ?? 0) + 1;
          console.info("[summary-worker] job dropped after cancellation", {
            requestId,
            summaryId: job.summaryId,
            durationMs,
            model,
          });
          failed += 1;
          continue;
        }

        let emailStatus: "sent" | "skipped" | "error" = "skipped";
        let emailSkipReason: string | null = null;
        try {
          const recipientEmail = await getSummaryOwnerEmail(job.summaryId);
          const emailResult = await sendSummaryCompletedEmail({
            toEmail: recipientEmail,
            summaryId: job.summaryId,
            summaryText,
            originalContent: job.originalContent,
            requestUrl: request.url,
          });
          emailStatus = emailResult.status;
          emailSkipReason = emailResult.status === "skipped" ? emailResult.reason : null;
        } catch (emailError) {
          emailStatus = "error";
          console.error("[summary-worker] summary-complete email failed", {
            requestId,
            summaryId: job.summaryId,
            model,
            message: emailError instanceof Error ? emailError.message : "unknown error",
          });
        }

        console.info("[summary-worker] job completed", {
          requestId,
          summaryId: job.summaryId,
          durationMs,
          model,
          emailStatus,
          emailSkipReason,
        });
        completed += 1;
      } catch (error) {
        const errorCode = extractErrorCode(error);
        const errorMessage = toErrorMessage(error);
        const durationMs = Date.now() - startedAt;
        jobDurations.push(durationMs);
        failureCodes[errorCode] = (failureCodes[errorCode] ?? 0) + 1;

        const failResult = await failSummaryJob({
          summaryId: job.summaryId,
          jobId: job.jobId,
          attemptCount: job.attemptCount,
          errorMessage: `[${errorCode}] ${errorMessage}`,
          maxAttempts: resolveMaxAttempts(errorCode, job.attemptCount),
        });

        let creditRefunded = false;
        let refundError: string | null = null;
        if (failResult.terminal && !failResult.canceledByUser && failResult.userId) {
          try {
            const restoredCredits = await restoreUserCredit(failResult.userId);
            creditRefunded = restoredCredits !== null;
            if (!creditRefunded) {
              refundError = "refund-user-not-found";
            }
          } catch (restoreError) {
            refundError = restoreError instanceof Error ? restoreError.message : "unknown refund error";
          }
        }

        console.info("[summary-worker] job failed", {
          requestId,
          summaryId: job.summaryId,
          durationMs,
          model,
          errorCode,
          terminal: failResult.terminal,
          canceledByUser: failResult.canceledByUser,
          creditRefunded,
          refundError,
        });
        failed += 1;
      }
    }

    return NextResponse.json(
      {
        picked: jobs.length,
        completed,
        failed,
        avgDurationMs: avgDurationMs(jobDurations),
        failureCodes,
      },
      { status: 200 },
    );
  } catch (error) {
    const errorCode = extractErrorCode(error);
    return NextResponse.json(
      {
        error: toErrorMessage(error),
        code: errorCode,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return runWorker(request);
}

export async function POST(request: Request) {
  return runWorker(request);
}
