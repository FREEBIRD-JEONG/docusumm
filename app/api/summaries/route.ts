import { NextResponse } from "next/server";

import { deleteSummariesByUser, listSummariesByUser } from "@/db/repositories/summary-repository";
import { resolveApiUser } from "@/lib/auth/api-user";

export const dynamic = "force-dynamic";

function parseLimit(url: URL): number {
  const value = Number.parseInt(url.searchParams.get("limit") ?? "30", 10);
  if (!Number.isFinite(value) || value <= 0) {
    return 30;
  }
  return Math.min(value, 100);
}

export async function GET(request: Request) {
  const { userId, errorResponse } = await resolveApiUser();
  if (errorResponse) {
    return errorResponse;
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

export async function DELETE() {
  const { userId, errorResponse } = await resolveApiUser();
  if (errorResponse) {
    return errorResponse;
  }

  try {
    const deletedCount = await deleteSummariesByUser(userId);
    return NextResponse.json({ deletedCount }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "히스토리 삭제 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
