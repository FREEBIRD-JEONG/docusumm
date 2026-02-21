import { NextResponse } from "next/server";

import { applyStripeCheckoutCompletedEvent } from "@/db/repositories/billing-repository";
import { extractErrorCode } from "@/lib/errors/error-messages";
import { verifyStripeWebhookSignature } from "@/lib/stripe/client";
import { getCreditPackageById } from "@/lib/stripe/packages";

export const dynamic = "force-dynamic";

interface StripeCheckoutSessionObject {
  id: string;
  metadata?: Record<string, string | undefined> | null;
}

function asCheckoutSessionObject(value: unknown): StripeCheckoutSessionObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const session = value as { id?: unknown; metadata?: unknown };
  if (typeof session.id !== "string") {
    return null;
  }

  const metadata =
    session.metadata && typeof session.metadata === "object"
      ? (session.metadata as Record<string, string | undefined>)
      : null;

  return {
    id: session.id,
    metadata,
  };
}

function invalidMetadataResponse(reason: string) {
  return NextResponse.json(
    {
      error: `[PAYMENT_WEBHOOK_METADATA_INVALID] ${reason}`,
      code: "PAYMENT_WEBHOOK_METADATA_INVALID",
    },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  let event: ReturnType<typeof verifyStripeWebhookSignature>;
  try {
    event = verifyStripeWebhookSignature(rawBody, request.headers.get("stripe-signature"));
  } catch (error) {
    const code = extractErrorCode(error instanceof Error ? error.message : "") ?? "PAYMENT_WEBHOOK_SIGNATURE_INVALID";
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "[PAYMENT_WEBHOOK_SIGNATURE_INVALID] Webhook signature verification failed.",
        code,
      },
      { status: 400 },
    );
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, handled: false }, { status: 200 });
  }

  const session = asCheckoutSessionObject(event.data.object);
  if (!session) {
    return invalidMetadataResponse("checkout session payload가 올바르지 않습니다.");
  }

  const userId = session.metadata?.userId ?? "";
  const packageId = session.metadata?.packageId ?? "";
  const creditsRaw = session.metadata?.credits ?? "";
  const parsedCredits = Number.parseInt(creditsRaw, 10);
  const selectedPackage = getCreditPackageById(packageId);

  if (!userId || !selectedPackage || !Number.isFinite(parsedCredits)) {
    return invalidMetadataResponse("필수 metadata(userId/packageId/credits)가 누락되었습니다.");
  }

  if (parsedCredits !== selectedPackage.credits) {
    return invalidMetadataResponse("metadata의 credits 값이 패키지 정의와 일치하지 않습니다.");
  }

  try {
    const result = await applyStripeCheckoutCompletedEvent({
      stripeEventId: event.id,
      stripeEventType: event.type,
      stripeSessionId: session.id,
      userId,
      packageId: selectedPackage.id,
      credits: parsedCredits,
    });

    if (!result.processed) {
      return NextResponse.json(
        {
          received: true,
          handled: true,
          duplicate: true,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        received: true,
        handled: true,
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
            : "[PAYMENT_WEBHOOK_PROCESS_FAILED] Webhook 처리 중 오류가 발생했습니다.",
        code,
      },
      { status },
    );
  }
}
