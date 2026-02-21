import { NextResponse } from "next/server";

import { createSummary, enqueueSummaryJob } from "@/db/repositories/summary-repository";
import { consumeUserCredit, restoreUserCredit } from "@/db/repositories/user-repository";
import { resolveApiUser } from "@/lib/auth/api-user";
import { normalizeYouTubeUrl } from "@/lib/validators/youtube";
import {
  parseCreateSummaryPayload,
  validateSummaryRequest,
} from "@/lib/validators/summary-request";

export const dynamic = "force-dynamic";
const WORKER_TRIGGER_TIMEOUT_MS = 1_200;

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveWorkerTriggerHeaders(): Record<string, string> {
  const workerSecret = process.env.INTERNAL_WORKER_SECRET?.trim();
  if (workerSecret) {
    return { "x-worker-secret": workerSecret };
  }

  return {};
}

function shouldAutoTriggerWorker(): boolean {
  const configured = process.env.AUTO_TRIGGER_WORKER_ON_SUMMARY_CREATE;
  if (configured !== undefined) {
    return parseBoolean(configured);
  }

  return true;
}

async function triggerWorkerInBackground(origin: string): Promise<void> {
  const headers = resolveWorkerTriggerHeaders();

  const workerUrl = new URL("/api/internal/summary-worker", origin);
  const resolvedHeaders = Object.keys(headers).length > 0 ? headers : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TRIGGER_TIMEOUT_MS);
  try {
    await fetch(workerUrl, {
      method: "POST",
      headers: resolvedHeaders,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    console.error("[summary] failed to trigger worker", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const { userId, errorResponse } = await resolveApiUser({ ensureProfile: true });
  if (errorResponse) {
    return errorResponse;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문을 파싱할 수 없습니다." }, { status: 400 });
  }

  const payload = parseCreateSummaryPayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다. sourceType/content를 확인해 주세요." },
      { status: 400 },
    );
  }

  const validation = validateSummaryRequest(payload);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: 422 });
  }

  let creditCharged = false;
  try {
    const normalizedContent =
      payload.sourceType === "youtube"
        ? normalizeYouTubeUrl(payload.content)
        : payload.content.trim();

    if (!normalizedContent) {
      return NextResponse.json(
        { error: "유효한 YouTube URL을 입력해 주세요." },
        { status: 422 },
      );
    }

    const remainingCredits = await consumeUserCredit(userId);
    if (remainingCredits === null) {
      return NextResponse.json(
        {
          error: "[INSUFFICIENT_CREDITS] 크레딧이 부족합니다. 크레딧을 충전한 뒤 다시 시도해 주세요.",
          code: "INSUFFICIENT_CREDITS",
        },
        { status: 402 },
      );
    }
    creditCharged = true;

    const summary = await createSummary({
      sourceType: payload.sourceType,
      originalContent: normalizedContent,
      userId,
    });
    await enqueueSummaryJob(summary.id);
    if (shouldAutoTriggerWorker()) {
      await triggerWorkerInBackground(new URL(request.url).origin);
    }

    return NextResponse.json(
      {
        id: summary.id,
        status: summary.status,
        summary: summary.summaryText,
        remainingCredits,
      },
      { status: 202 },
    );
  } catch (error) {
    if (creditCharged) {
      try {
        await restoreUserCredit(userId);
      } catch (rollbackError) {
        console.error("[summary] failed to restore credit after error", {
          message: rollbackError instanceof Error ? rollbackError.message : "unknown rollback error",
          userId,
        });
      }
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "요약 요청 처리 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
