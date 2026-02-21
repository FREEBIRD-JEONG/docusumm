import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  getCheckoutSessionById: vi.fn(),
}));

vi.mock("@/db/repositories/billing-repository", () => ({
  applyStripeCheckoutCompletedEvent: vi.fn(),
}));

import { resolveApiUser } from "@/lib/auth/api-user";
import { getCheckoutSessionById } from "@/lib/stripe/client";
import { applyStripeCheckoutCompletedEvent } from "@/db/repositories/billing-repository";

import { POST } from "./route";

const mockedResolveApiUser = vi.mocked(resolveApiUser);
const mockedGetCheckoutSessionById = vi.mocked(getCheckoutSessionById);
const mockedApplyStripeCheckoutCompletedEvent = vi.mocked(applyStripeCheckoutCompletedEvent);

describe("/api/payments/confirm route", () => {
  beforeEach(() => {
    mockedResolveApiUser.mockReset();
    mockedGetCheckoutSessionById.mockReset();
    mockedApplyStripeCheckoutCompletedEvent.mockReset();
  });

  it("returns auth error response from resolver", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "",
      email: null,
      errorResponse: NextResponse.json({ error: "로그인이 필요합니다. 다시 로그인해 주세요." }, { status: 401 }),
    });

    const response = await POST(
      new Request("http://localhost/api/payments/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_123" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for missing sessionId", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });

    const response = await POST(
      new Request("http://localhost/api/payments/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockedGetCheckoutSessionById).not.toHaveBeenCalled();
  });

  it("returns handled false when payment is not yet paid", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedGetCheckoutSessionById.mockResolvedValue({
      id: "cs_test_123",
      paymentStatus: "unpaid",
      status: "open",
      metadata: {
        userId: "user-1",
        packageId: "starter",
        credits: "30",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/payments/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_123" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      handled: false,
      paid: false,
    });
    expect(mockedApplyStripeCheckoutCompletedEvent).not.toHaveBeenCalled();
  });

  it("returns 403 when checkout session owner differs from current user", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedGetCheckoutSessionById.mockResolvedValue({
      id: "cs_test_123",
      paymentStatus: "paid",
      status: "complete",
      metadata: {
        userId: "user-2",
        packageId: "starter",
        credits: "30",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/payments/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_123" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mockedApplyStripeCheckoutCompletedEvent).not.toHaveBeenCalled();
  });

  it("processes paid checkout session and updates credits", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedGetCheckoutSessionById.mockResolvedValue({
      id: "cs_test_123",
      paymentStatus: "paid",
      status: "complete",
      metadata: {
        userId: "user-1",
        packageId: "starter",
        credits: "30",
      },
    });
    mockedApplyStripeCheckoutCompletedEvent.mockResolvedValue({
      processed: true,
      newCredits: 33,
    });

    const response = await POST(
      new Request("http://localhost/api/payments/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_123" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      handled: true,
      processed: true,
      duplicate: false,
      newCredits: 33,
    });
    expect(mockedApplyStripeCheckoutCompletedEvent).toHaveBeenCalledWith({
      stripeEventId: "checkout_session:cs_test_123",
      stripeEventType: "checkout.session.completed",
      stripeSessionId: "cs_test_123",
      userId: "user-1",
      packageId: "starter",
      credits: 30,
    });
  });

  it("marks duplicate when session was already applied", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedGetCheckoutSessionById.mockResolvedValue({
      id: "cs_test_dup",
      paymentStatus: "paid",
      status: "complete",
      metadata: {
        userId: "user-1",
        packageId: "pro",
        credits: "50",
      },
    });
    mockedApplyStripeCheckoutCompletedEvent.mockResolvedValue({ processed: false });

    const response = await POST(
      new Request("http://localhost/api/payments/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_dup" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      handled: true,
      processed: false,
      duplicate: true,
      newCredits: null,
    });
  });
});
