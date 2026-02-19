import { NextResponse } from "next/server";

import { getSummaryById } from "@/db/repositories/summary-repository";
import { getGuestUserId, isAuthEnabled } from "@/lib/auth/runtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;

  if (!isAuthEnabled()) {
    userId = getGuestUserId();
  } else {
    try {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        return NextResponse.json({ error: "로그인이 필요합니다. 다시 로그인해 주세요." }, { status: 401 });
      }
      userId = user.id;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "인증 확인 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }
  }

  const { id } = await params;
  try {
    const summary = await getSummaryById(id, userId);
    if (!summary) {
      return NextResponse.json({ error: "요약 결과를 찾을 수 없습니다." }, { status: 404 });
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
