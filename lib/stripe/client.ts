import { createHmac, timingSafeEqual } from "node:crypto";

import { getStripeApiConfig } from "@/lib/stripe/config";
import type { CreditPackageId } from "@/lib/stripe/packages";

const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";
const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface CreateCheckoutSessionInput {
  userId: string;
  packageId: CreditPackageId;
  credits: number;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

export interface StripeCheckoutSessionDetails {
  id: string;
  paymentStatus: string | null;
  status: string | null;
  metadata: Record<string, string | undefined> | null;
}

export interface StripeWebhookEvent<T = unknown> {
  id: string;
  type: string;
  data: {
    object: T;
  };
}

interface StripeCheckoutSessionCreateApiResponse {
  id?: string;
  url?: string;
  error?: {
    message?: string;
  };
}

interface StripeCheckoutSessionRetrieveApiResponse {
  id?: string;
  payment_status?: string;
  status?: string;
  metadata?: Record<string, string | undefined> | null;
  error?: {
    message?: string;
  };
}

function parseStripeSignatureHeader(value: string): {
  timestamp: string | null;
  signatures: string[];
} {
  const timestamp = value
    .split(",")
    .map((item) => item.trim())
    .find((item) => item.startsWith("t="))
    ?.slice(2) ?? null;

  const signatures = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("v1="))
    .map((item) => item.slice(3))
    .filter(Boolean);

  return { timestamp, signatures };
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length === 0 || rightBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<StripeCheckoutSession> {
  const config = getStripeApiConfig();
  const priceId = config.prices[input.packageId];

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", input.successUrl);
  form.set("cancel_url", input.cancelUrl);
  form.set("client_reference_id", input.userId);
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("metadata[userId]", input.userId);
  form.set("metadata[packageId]", input.packageId);
  form.set("metadata[credits]", String(input.credits));

  const response = await fetch(`${STRIPE_API_BASE_URL}/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as StripeCheckoutSessionCreateApiResponse | null;

  if (!response.ok || !data?.id || !data.url) {
    const reason = data?.error?.message ?? "Stripe checkout session creation failed.";
    throw new Error(`[PAYMENT_CHECKOUT_CREATE_FAILED] ${reason}`);
  }

  return { id: data.id, url: data.url };
}

export async function getCheckoutSessionById(sessionId: string): Promise<StripeCheckoutSessionDetails> {
  const config = getStripeApiConfig();
  const response = await fetch(`${STRIPE_API_BASE_URL}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${config.secretKey}`,
    },
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as StripeCheckoutSessionRetrieveApiResponse | null;

  if (!response.ok || !data?.id) {
    const reason = data?.error?.message ?? "Stripe checkout session retrieval failed.";
    throw new Error(`[PAYMENT_CHECKOUT_VERIFY_FAILED] ${reason}`);
  }

  return {
    id: data.id,
    paymentStatus: typeof data.payment_status === "string" ? data.payment_status : null,
    status: typeof data.status === "string" ? data.status : null,
    metadata:
      data.metadata && typeof data.metadata === "object"
        ? (data.metadata as Record<string, string | undefined>)
        : null,
  };
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): StripeWebhookEvent {
  if (!signatureHeader) {
    throw new Error("[PAYMENT_WEBHOOK_SIGNATURE_INVALID] stripe-signature header is required.");
  }

  const { webhookSecret } = getStripeApiConfig();
  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);

  if (!timestamp || signatures.length === 0) {
    throw new Error("[PAYMENT_WEBHOOK_SIGNATURE_INVALID] Invalid stripe-signature header format.");
  }

  const timestampNumber = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampNumber)) {
    throw new Error("[PAYMENT_WEBHOOK_SIGNATURE_INVALID] Invalid stripe-signature timestamp.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNumber) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("[PAYMENT_WEBHOOK_SIGNATURE_INVALID] Expired stripe-signature timestamp.");
  }

  const payload = `${timestamp}.${rawBody}`;
  const expectedSignature = createHmac("sha256", webhookSecret).update(payload, "utf8").digest("hex");
  const matched = signatures.some((signature) => safeEqualHex(signature, expectedSignature));

  if (!matched) {
    throw new Error("[PAYMENT_WEBHOOK_SIGNATURE_INVALID] Signature verification failed.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error("[PAYMENT_WEBHOOK_SIGNATURE_INVALID] Invalid webhook payload.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("id" in parsed) ||
    !("type" in parsed) ||
    !("data" in parsed)
  ) {
    throw new Error("[PAYMENT_WEBHOOK_SIGNATURE_INVALID] Webhook payload shape is invalid.");
  }

  return parsed as StripeWebhookEvent;
}
