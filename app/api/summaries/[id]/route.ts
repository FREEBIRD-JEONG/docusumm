import { NextResponse } from "next/server";

import { getSummaryById } from "@/db/repositories/summary-repository";
import { resolveApiUser } from "@/lib/auth/api-user";
import type { SummaryRecord } from "@/types/summary";

export const dynamic = "force-dynamic";
const WORKER_RETRIGGER_THRESHOLD_MS = 5_000;
const WORKER_TRIGGER_TIMEOUT_MS = 900;

function parseUpdatedAt(value: string): number | null {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldRetriggerWorker(summary: SummaryRecord): boolean {
  if (summary.status !== "pending") {
    return false;
  }

  const updatedAtMs = parseUpdatedAt(summary.updatedAt);
  if (updatedAtMs === null) {
    return true;
  }

  return Date.now() - updatedAtMs >= WORKER_RETRIGGER_THRESHOLD_MS;
}

function resolveWorkerTriggerHeaders(): Record<string, string> {
  const workerSecret = process.env.INTERNAL_WORKER_SECRET?.trim();
  if (workerSecret) {
    return { "x-worker-secret": workerSecret };
  }

  return {};
}

async function retriggerWorker(origin: string): Promise<void> {
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
    console.info("[summary-status] failed to retrigger worker", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId, errorResponse } = await resolveApiUser();
  if (errorResponse) {
    return errorResponse;
  }

  const { id } = await params;
  try {
    const summary = await getSummaryById(id, userId);
    if (!summary) {
      return NextResponse.json({ error: "요약 결과를 찾을 수 없습니다." }, { status: 404 });
    }

    if (shouldRetriggerWorker(summary)) {
      await retriggerWorker(new URL(_request.url).origin);
    }

    return NextResponse.json(
      {
        id: summary.id,
        status: summary.status,
        summary: summary.summaryText,
        record: summary,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "요약 조회 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
