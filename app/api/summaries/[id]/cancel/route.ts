import { NextResponse } from "next/server";

import { cancelSummary, getSummaryById } from "@/db/repositories/summary-repository";
import { getGuestUserId, isAuthEnabled } from "@/lib/auth/runtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function resolveUserId(): Promise<{ userId: string; errorResponse: NextResponse | null }> {
  if (!isAuthEnabled()) {
    return { userId: getGuestUserId(), errorResponse: null };
  }

  try {
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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId, errorResponse } = await resolveUserId();
  if (errorResponse) {
    return errorResponse;
  }

  const { id } = await params;

  try {
    const existing = await getSummaryById(id, userId);
    if (!existing) {
      return NextResponse.json({ error: "요약 결과를 찾을 수 없습니다." }, { status: 404 });
    }

    const record = await cancelSummary(id, userId);
    if (!record) {
      return NextResponse.json({ error: "요약 결과를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ record }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "요약 취소 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
