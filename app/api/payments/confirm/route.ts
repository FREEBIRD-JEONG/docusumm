import { NextResponse } from "next/server";

import { applyStripeCheckoutCompletedEvent } from "@/db/repositories/billing-repository";
import { resolveApiUser } from "@/lib/auth/api-user";
import { extractErrorCode } from "@/lib/errors/error-messages";
import { getCheckoutSessionById } from "@/lib/stripe/client";
import { getCreditPackageById } from "@/lib/stripe/packages";

export const dynamic = "force-dynamic";

interface ConfirmCheckoutRequestBody {
  sessionId: string;
}

function invalidRequestResponse(reason: string) {
  return NextResponse.json(
    {
      error: `[PAYMENT_CHECKOUT_CONFIRM_INVALID] ${reason}`,
      code: "PAYMENT_CHECKOUT_CONFIRM_INVALID",
    },
    { status: 400 },
  );
}

function parseRequestBody(body: unknown): ConfirmCheckoutRequestBody | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const sessionId = "sessionId" in body && typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return null;
  }

  return { sessionId };
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
    return invalidRequestResponse("JSON 본문을 파싱할 수 없습니다.");
  }

  const parsed = parseRequestBody(body);
  if (!parsed) {
    return invalidRequestResponse("sessionId가 필요합니다.");
  }

  let session: Awaited<ReturnType<typeof getCheckoutSessionById>>;
  try {
    session = await getCheckoutSessionById(parsed.sessionId);
  } catch (error) {
    const code = extractErrorCode(error instanceof Error ? error.message : "") ?? "PAYMENT_CHECKOUT_VERIFY_FAILED";
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "[PAYMENT_CHECKOUT_VERIFY_FAILED] 결제 세션 확인 중 오류가 발생했습니다.",
        code,
      },
      { status: 502 },
    );
  }

  if (session.paymentStatus !== "paid") {
    return NextResponse.json(
      {
        received: true,
        handled: false,
        paid: false,
      },
      { status: 200 },
    );
  }

  const metadataUserId = session.metadata?.userId ?? "";
  const packageId = session.metadata?.packageId ?? "";
  const creditsRaw = session.metadata?.credits ?? "";
  const parsedCredits = Number.parseInt(creditsRaw, 10);
  const selectedPackage = getCreditPackageById(packageId);

  if (!metadataUserId || !selectedPackage || !Number.isFinite(parsedCredits)) {
    return invalidRequestResponse("필수 metadata(userId/packageId/credits)가 누락되었습니다.");
  }

  if (metadataUserId !== userId) {
    return NextResponse.json(
      {
        error: "[PAYMENT_CHECKOUT_OWNER_MISMATCH] 결제 세션 사용자와 현재 로그인 사용자가 일치하지 않습니다.",
        code: "PAYMENT_CHECKOUT_OWNER_MISMATCH",
      },
      { status: 403 },
    );
  }

  if (parsedCredits !== selectedPackage.credits) {
    return invalidRequestResponse("metadata의 credits 값이 패키지 정의와 일치하지 않습니다.");
  }

  try {
    const result = await applyStripeCheckoutCompletedEvent({
      stripeEventId: `checkout_session:${session.id}`,
      stripeEventType: "checkout.session.completed",
      stripeSessionId: session.id,
      userId: metadataUserId,
      packageId: selectedPackage.id,
      credits: parsedCredits,
    });

    return NextResponse.json(
      {
        received: true,
        handled: true,
        processed: result.processed,
        duplicate: !result.processed,
        newCredits: result.newCredits ?? null,
      },
      { status: 200 },
    );
  } catch (error) {
    const code = extractErrorCode(error instanceof Error ? error.message : "") ?? "PAYMENT_WEBHOOK_PROCESS_FAILED";
    const status = code === "PAYMENT_USER_NOT_FOUND" || code === "PAYMENT_CREDITS_INVALID" ? 400 : 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "[PAYMENT_WEBHOOK_PROCESS_FAILED] 결제 확정 처리 중 오류가 발생했습니다.",
        code,
      },
      { status },
    );
  }
}
