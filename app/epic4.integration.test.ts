import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

vi.mock("@/db/repositories/user-repository", () => ({
  consumeUserCredit: vi.fn(),
  restoreUserCredit: vi.fn(),
}));

vi.mock("@/db/repositories/summary-repository", () => ({
  createSummary: vi.fn(),
  enqueueSummaryJob: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  createCheckoutSession: vi.fn(),
  verifyStripeWebhookSignature: vi.fn(),
}));

vi.mock("@/db/repositories/billing-repository", () => ({
  applyStripeCheckoutCompletedEvent: vi.fn(),
}));

import { resolveApiUser } from "@/lib/auth/api-user";
import { consumeUserCredit, restoreUserCredit } from "@/db/repositories/user-repository";
import { createSummary, enqueueSummaryJob } from "@/db/repositories/summary-repository";
import { createCheckoutSession, verifyStripeWebhookSignature } from "@/lib/stripe/client";
import { applyStripeCheckoutCompletedEvent } from "@/db/repositories/billing-repository";

import { POST as createSummaryPost } from "@/app/api/summary/route";
import { POST as createCheckoutPost } from "@/app/api/payments/checkout/route";
import { POST as stripeWebhookPost } from "@/app/api/webhooks/stripe/route";

const mockedResolveApiUser = vi.mocked(resolveApiUser);
const mockedConsumeUserCredit = vi.mocked(consumeUserCredit);
const mockedRestoreUserCredit = vi.mocked(restoreUserCredit);
const mockedCreateSummary = vi.mocked(createSummary);
const mockedEnqueueSummaryJob = vi.mocked(enqueueSummaryJob);
const mockedCreateCheckoutSession = vi.mocked(createCheckoutSession);
const mockedVerifyStripeWebhookSignature = vi.mocked(verifyStripeWebhookSignature);
const mockedApplyStripeCheckoutCompletedEvent = vi.mocked(applyStripeCheckoutCompletedEvent);

describe("Epic 4 integrated scenario", () => {
  const userId = "epic4-user";
  let credits = 0;

  beforeEach(() => {
    credits = 0;
    delete process.env.INTERNAL_WORKER_SECRET;
    delete process.env.CRON_SECRET;
    process.env.AUTO_TRIGGER_WORKER_ON_SUMMARY_CREATE = "false";
    delete process.env.NEXT_PUBLIC_APP_URL;

    mockedResolveApiUser.mockReset();
    mockedConsumeUserCredit.mockReset();
    mockedRestoreUserCredit.mockReset();
    mockedCreateSummary.mockReset();
    mockedEnqueueSummaryJob.mockReset();
    mockedCreateCheckoutSession.mockReset();
    mockedVerifyStripeWebhookSignature.mockReset();
    mockedApplyStripeCheckoutCompletedEvent.mockReset();

    mockedResolveApiUser.mockResolvedValue({
      userId,
      email: "epic4@example.com",
      errorResponse: null,
    });

    mockedConsumeUserCredit.mockImplementation(async () => {
      if (credits <= 0) {
        return null;
      }
      credits -= 1;
      return credits;
    });
    mockedRestoreUserCredit.mockImplementation(async () => {
      credits += 1;
      return credits;
    });

    mockedCreateSummary.mockResolvedValue({
      id: "summary-1",
      userId,
      sourceType: "text",
      originalContent: "Epic 4 integration long enough text for the summary request to pass validation.",
      summaryText: null,
      status: "pending",
      errorMessage: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    });
    mockedEnqueueSummaryJob.mockResolvedValue(undefined);

    mockedCreateCheckoutSession.mockResolvedValue({
      id: "cs_test_001",
      url: "https://checkout.stripe.com/pay/cs_test_001",
    });

    mockedVerifyStripeWebhookSignature.mockReturnValue({
      id: "evt_epic4_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_001",
          metadata: {
            userId,
            packageId: "starter",
            credits: "30",
          },
        },
      },
    });

    mockedApplyStripeCheckoutCompletedEvent.mockImplementation(async ({ credits: paidCredits }) => {
      credits += paidCredits;
      return { processed: true, newCredits: credits };
    });
  });

  it("insufficient credit -> checkout -> webhook recharge -> summary retry success", async () => {
    const summaryBeforeCharge = await createSummaryPost(
      new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content: "This integration test text must be longer than forty characters for validation.",
        }),
      }),
    );
    expect(summaryBeforeCharge.status).toBe(402);

    const checkoutResponse = await createCheckoutPost(
      new Request("http://localhost/api/payments/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: "starter" }),
      }),
    );
    expect(checkoutResponse.status).toBe(200);

    const webhookResponse = await stripeWebhookPost(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "valid-signature" },
        body: JSON.stringify({ any: "payload" }),
      }),
    );
    expect(webhookResponse.status).toBe(200);

    const summaryAfterCharge = await createSummaryPost(
      new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content: "This integration test text must be longer than forty characters for validation.",
        }),
      }),
    );
    expect(summaryAfterCharge.status).toBe(202);
    const summaryAfterChargeData = (await summaryAfterCharge.json()) as { remainingCredits?: number };
    expect(summaryAfterChargeData.remainingCredits).toBe(29);
  });
});
