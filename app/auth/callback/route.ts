import { NextResponse, type NextRequest } from "next/server";

import { upsertUserProfile } from "@/db/repositories/user-repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function sanitizeNextPath(nextPath: string | null): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/";
  }
  return nextPath;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = sanitizeNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "missing_code");
    loginUrl.searchParams.set("next", nextPath);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      throw error;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await upsertUserProfile({
        id: user.id,
        email: user.email ?? `${user.id}@local.invalid`,
      });
    }

    return NextResponse.redirect(new URL(nextPath, request.url));
  } catch {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "oauth_failed");
    loginUrl.searchParams.set("next", nextPath);
    return NextResponse.redirect(loginUrl);
  }
}
