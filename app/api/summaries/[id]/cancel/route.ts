import { NextResponse } from "next/server";

import { cancelSummary, getSummaryById } from "@/db/repositories/summary-repository";
import { resolveApiUser } from "@/lib/auth/api-user";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId, errorResponse } = await resolveApiUser();
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
