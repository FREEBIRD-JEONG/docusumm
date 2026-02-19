import { NextResponse } from "next/server";

import { createSummary, enqueueSummaryJob } from "@/db/repositories/summary-repository";
import { upsertUserProfile } from "@/db/repositories/user-repository";
import { getGuestUserEmail, getGuestUserId, isAuthEnabled } from "@/lib/auth/runtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeYouTubeUrl } from "@/lib/validators/youtube";
import {
  parseCreateSummaryPayload,
  validateSummaryRequest,
} from "@/lib/validators/summary-request";

export const dynamic = "force-dynamic";

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldAutoTriggerWorker(): boolean {
  if (!process.env.INTERNAL_WORKER_SECRET) {
    return false;
  }

  const configured = process.env.AUTO_TRIGGER_WORKER_ON_SUMMARY_CREATE;
  if (configured !== undefined) {
    return parseBoolean(configured);
  }

  return process.env.NODE_ENV !== "production";
}

function triggerWorkerInBackground(origin: string): void {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (!secret) {
    return;
  }

  const workerUrl = new URL("/api/internal/summary-worker", origin);
  void fetch(workerUrl, {
    method: "POST",
    headers: {
      "x-worker-secret": secret,
    },
    cache: "no-store",
  }).catch((error) => {
    console.error("[summary] failed to trigger worker", {
      message: error instanceof Error ? error.message : "unknown error",
    });
  });
}

async function resolveUserId(): Promise<{ userId: string; errorResponse: NextResponse | null }> {
  try {
    if (!isAuthEnabled()) {
      const guestUserId = getGuestUserId();
      await upsertUserProfile({
        id: guestUserId,
        email: getGuestUserEmail(guestUserId),
      });
      return { userId: guestUserId, errorResponse: null };
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        userId: "",
        errorResponse: NextResponse.json(
          { error: "로그인이 필요합니다. 다시 로그인해 주세요." },
          { status: 401 },
        ),
      };
    }

    await upsertUserProfile({
      id: user.id,
      email: user.email ?? `${user.id}@local.invalid`,
    });
    return { userId: user.id, errorResponse: null };
  } catch (error) {
    return {
      userId: "",
      errorResponse: NextResponse.json(
        { error: error instanceof Error ? error.message : "인증 확인 중 오류가 발생했습니다." },
        { status: 500 },
      ),
    };
  }
}

export async function POST(request: Request) {
  const { userId, errorResponse } = await resolveUserId();
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

    const summary = await createSummary({
      sourceType: payload.sourceType,
      originalContent: normalizedContent,
      userId,
    });
    await enqueueSummaryJob(summary.id);
    if (shouldAutoTriggerWorker()) {
      triggerWorkerInBackground(new URL(request.url).origin);
    }

    return NextResponse.json(
      {
        id: summary.id,
        status: summary.status,
        summary: summary.summaryText,
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "요약 요청 처리 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
