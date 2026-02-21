import { NextResponse } from "next/server";

import { getSummaryById } from "@/db/repositories/summary-repository";
import { resolveApiUser } from "@/lib/auth/api-user";

export const dynamic = "force-dynamic";

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
