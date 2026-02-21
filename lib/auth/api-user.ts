import { NextResponse } from "next/server";

import { upsertUserProfile } from "@/db/repositories/user-repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGuestUserEmail, getGuestUserId, isAuthEnabled } from "@/lib/auth/runtime";

export const AUTH_REQUIRED_ERROR_MESSAGE = "로그인이 필요합니다. 다시 로그인해 주세요.";
export const AUTH_CHECK_FAILED_ERROR_MESSAGE = "인증 확인 중 오류가 발생했습니다.";

interface ResolveApiUserOptions {
  ensureProfile?: boolean;
}

interface ResolveApiUserResult {
  userId: string;
  email: string | null;
  errorResponse: NextResponse | null;
}

export async function resolveApiUser(
  options: ResolveApiUserOptions = {},
): Promise<ResolveApiUserResult> {
  const { ensureProfile = false } = options;

  try {
    if (!isAuthEnabled()) {
      const userId = getGuestUserId();
      const email = getGuestUserEmail(userId);

      if (ensureProfile) {
        await upsertUserProfile({ id: userId, email });
      }

      return { userId, email, errorResponse: null };
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        userId: "",
        email: null,
        errorResponse: NextResponse.json({ error: AUTH_REQUIRED_ERROR_MESSAGE }, { status: 401 }),
      };
    }

    const email = user.email ?? `${user.id}@local.invalid`;
    if (ensureProfile) {
      await upsertUserProfile({ id: user.id, email });
    }

    return { userId: user.id, email, errorResponse: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : AUTH_CHECK_FAILED_ERROR_MESSAGE;
    return {
      userId: "",
      email: null,
      errorResponse: NextResponse.json({ error: message }, { status: 500 }),
    };
  }
}

