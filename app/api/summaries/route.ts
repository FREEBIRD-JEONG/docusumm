import { NextResponse } from "next/server";

import { listSummariesByUser } from "@/db/repositories/summary-repository";
import { getGuestUserId, isAuthEnabled } from "@/lib/auth/runtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function parseLimit(url: URL): number {
  const value = Number.parseInt(url.searchParams.get("limit") ?? "30", 10);
  if (!Number.isFinite(value) || value <= 0) {
    return 30;
  }
  return Math.min(value, 100);
}

export async function GET(request: Request) {
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

  const limit = parseLimit(new URL(request.url));

  try {
    const items = await listSummariesByUser(userId, limit);
    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "요약 목록 조회 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
