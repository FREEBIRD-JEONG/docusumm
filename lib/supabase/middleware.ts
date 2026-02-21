import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth/next-path";
import { isAuthEnabled } from "@/lib/auth/runtime";
import { getSupabaseConfig } from "@/lib/supabase/config";

function isPublicPage(pathname: string): boolean {
  return pathname === "/login" || pathname === "/auth/callback";
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (!isAuthEnabled()) {
    return NextResponse.next({ request });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const pathname = request.nextUrl.pathname;
  const isPublic = isPublicPage(pathname);
  let userId: string | null = null;

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (!error) {
      userId = user?.id ?? null;
    }
  } catch {
    // Supabase auth endpoint 실패 시 500 대신 안전하게 로그인으로 유도한다.
    if (!isPublic) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      const nextPath = sanitizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
      redirectUrl.searchParams.set("next", nextPath);
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  if (!userId && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    const nextPath = sanitizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
    redirectUrl.searchParams.set("next", nextPath);
    return NextResponse.redirect(redirectUrl);
  }

  if (userId && pathname === "/login") {
    const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(new URL(nextPath, request.url));
  }

  return response;
}
