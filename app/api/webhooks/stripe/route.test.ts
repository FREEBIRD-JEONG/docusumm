import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe/client", () => ({
  verifyStripeWebhookSignature: vi.fn(),
}));

vi.mock("@/db/repositories/billing-repository", () => ({
  applyStripeCheckoutCompletedEvent: vi.fn(),
}));

import { applyStripeCheckoutCompletedEvent } from "@/db/repositories/billing-repository";
import { verifyStripeWebhookSignature } from "@/lib/stripe/client";

import { POST } from "./route";

const mockedVerifyStripeWebhookSignature = vi.mocked(verifyStripeWebhookSignature);
const mockedApplyStripeCheckoutCompletedEvent = vi.mocked(applyStripeCheckoutCompletedEvent);

describe("/api/webhooks/stripe route", () => {
  beforeEach(() => {
    mockedVerifyStripeWebhookSignature.mockReset();
    mockedApplyStripeCheckoutCompletedEvent.mockReset();
  });

  it("returns 400 when signature verification fails", async () => {
    mockedVerifyStripeWebhookSignature.mockImplementation(() => {
      throw new Error("[PAYMENT_WEBHOOK_SIGNATURE_INVALID] invalid signature");
    });

    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "invalid" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockedApplyStripeCheckoutCompletedEvent).not.toHaveBeenCalled();
  });

  it("returns handled false for non-checkout event", async () => {
    mockedVerifyStripeWebhookSignature.mockReturnValue({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: {} },
    });

    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: false });
  });

  it("processes checkout.session.completed event", async () => {
    mockedVerifyStripeWebhookSignature.mockReturnValue({
      id: "evt_complete_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          metadata: {
            userId: "user-1",
            packageId: "starter",
            credits: "30",
          },
        },
      },
    });
    mockedApplyStripeCheckoutCompletedEvent.mockResolvedValue({
      processed: true,
      newCredits: 35,
    });

    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: true });
    expect(mockedApplyStripeCheckoutCompletedEvent).toHaveBeenCalledWith({
      stripeEventId: "evt_complete_1",
      stripeEventType: "checkout.session.completed",
      stripeSessionId: "cs_test_1",
      userId: "user-1",
      packageId: "starter",
      credits: 30,
    });
  });

  it("marks duplicate event when already processed", async () => {
    mockedVerifyStripeWebhookSignature.mockReturnValue({
      id: "evt_duplicate_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_dup",
          metadata: {
            userId: "user-1",
            packageId: "pro",
            credits: "50",
          },
        },
      },
    });
    mockedApplyStripeCheckoutCompletedEvent.mockResolvedValue({ processed: false });

    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      handled: true,
      duplicate: true,
    });
  });
});
