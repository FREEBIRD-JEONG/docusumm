import { NextResponse } from "next/server";

import { resolveApiUser } from "@/lib/auth/api-user";
import { extractErrorCode } from "@/lib/errors/error-messages";
import { createCheckoutSession } from "@/lib/stripe/client";
import { getCreditPackageById } from "@/lib/stripe/packages";

export const dynamic = "force-dynamic";

function resolveAppBaseUrl(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).toString().replace(/\/$/, "");
    } catch {
      // Ignore malformed override and fallback to request origin.
    }
  }
  return new URL(requestUrl).origin;
}

export async function POST(request: Request) {
  const { userId, errorResponse } = await resolveApiUser({ ensureProfile: true });
  if (errorResponse) {
    return errorResponse;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "JSON 본문을 파싱할 수 없습니다.", code: "PAYMENT_REQUEST_INVALID" },
      { status: 400 },
    );
  }

  const packageId =
    body && typeof body === "object" && "packageId" in body && typeof body.packageId === "string"
      ? body.packageId
      : null;

  const selectedPackage = getCreditPackageById(packageId);
  if (!selectedPackage) {
    return NextResponse.json(
      {
        error: "[PAYMENT_PACKAGE_INVALID] 올바른 크레딧 패키지를 선택해 주세요.",
        code: "PAYMENT_PACKAGE_INVALID",
      },
      { status: 422 },
    );
  }

  const appBaseUrl = resolveAppBaseUrl(request.url);
  const successUrl = `${appBaseUrl}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appBaseUrl}/dashboard?payment=canceled`;

  try {
    const session = await createCheckoutSession({
      userId,
      packageId: selectedPackage.id,
      credits: selectedPackage.credits,
      successUrl,
      cancelUrl,
    });

    return NextResponse.json(
      {
        url: session.url,
        sessionId: session.id,
      },
      { status: 200 },
    );
  } catch (error) {
    const code = extractErrorCode(error instanceof Error ? error.message : "") ?? "PAYMENT_CHECKOUT_CREATE_FAILED";
    const message =
      error instanceof Error
        ? error.message
        : "[PAYMENT_CHECKOUT_CREATE_FAILED] 결제 세션 생성 중 오류가 발생했습니다.";

    return NextResponse.json({ error: message, code }, { status: 500 });
  }
}
