import { NextResponse } from "next/server";

import { getUserProfileById } from "@/db/repositories/user-repository";
import { resolveApiUser } from "@/lib/auth/api-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, email, errorResponse } = await resolveApiUser({ ensureProfile: true });
  if (errorResponse) {
    return errorResponse;
  }

  try {
    const profile = await getUserProfileById(userId);
    if (!profile) {
      return NextResponse.json({ error: "계정 정보를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: profile.id,
        email: profile.email || email || "",
        credits: profile.credits,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "계정 정보 조회 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
