import { NextResponse } from "next/server";

import {
  claimSummaryJobs,
  completeSummaryJob,
  failSummaryJob,
  markSummaryProcessing,
} from "@/db/repositories/summary-repository";
import { AppError } from "@/lib/errors/app-error";
import { summarizeWithFallback } from "@/lib/gemini/summarize";

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
  const workerSecret = process.env.INTERNAL_WORKER_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = request.headers.get("x-worker-secret");
  const authHeader = request.headers.get("authorization");
  const isWorkerHeaderValid = Boolean(workerSecret && requestSecret === workerSecret);
  const isCronHeaderValid = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isWorkerHeaderValid && !isCronHeaderValid) {
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
        if (result.usedFallback && job.sourceType === "youtube" && result.fallbackKind === "generic") {
          const errorCode = result.fallbackReasonCode ?? "GEMINI_UNKNOWN_ERROR";
          const failureMessage = errorCode === "GEMINI_REQUEST_FAILED"
            ? `[${errorCode}] 모델 응답을 확보하지 못했습니다 (429 가능). API 키/쿼터를 확인한 뒤 다시 시도해 주세요.`
            : `[${errorCode}] 모델 응답을 확보하지 못해 요약을 완료하지 않았습니다.`;
          const durationMs = Date.now() - startedAt;
          jobDurations.push(durationMs);
          failureCodes[errorCode] = (failureCodes[errorCode] ?? 0) + 1;

          await failSummaryJob({
            summaryId: job.summaryId,
            jobId: job.jobId,
            attemptCount: job.attemptCount,
            errorMessage: failureMessage,
            maxAttempts: resolveMaxAttempts(errorCode, job.attemptCount),
          });
          console.info("[summary-worker] job failed (fallback blocked)", {
            requestId,
            summaryId: job.summaryId,
            durationMs,
            model,
            errorCode,
          });
          failed += 1;
          continue;
        }

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
        console.info("[summary-worker] job completed", {
          requestId,
          summaryId: job.summaryId,
          durationMs,
          model,
          fallbackUsed: result.usedFallback,
          fallbackReasonCode: result.fallbackReasonCode ?? null,
        });
        completed += 1;
      } catch (error) {
        const errorCode = extractErrorCode(error);
        const errorMessage = toErrorMessage(error);
        const durationMs = Date.now() - startedAt;
        jobDurations.push(durationMs);
        failureCodes[errorCode] = (failureCodes[errorCode] ?? 0) + 1;

        await failSummaryJob({
          summaryId: job.summaryId,
          jobId: job.jobId,
          attemptCount: job.attemptCount,
          errorMessage: `[${errorCode}] ${errorMessage}`,
          maxAttempts: resolveMaxAttempts(errorCode, job.attemptCount),
        });
        console.info("[summary-worker] job failed", {
          requestId,
          summaryId: job.summaryId,
          durationMs,
          model,
          errorCode,
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
