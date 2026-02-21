import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  createCheckoutSession: vi.fn(),
}));

import { resolveApiUser } from "@/lib/auth/api-user";
import { createCheckoutSession } from "@/lib/stripe/client";

import { POST } from "./route";

const mockedResolveApiUser = vi.mocked(resolveApiUser);
const mockedCreateCheckoutSession = vi.mocked(createCheckoutSession);

describe("/api/payments/checkout route", () => {
  beforeEach(() => {
    mockedResolveApiUser.mockReset();
    mockedCreateCheckoutSession.mockReset();
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("returns auth error response from resolver", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "",
      email: null,
      errorResponse: NextResponse.json({ error: "로그인이 필요합니다. 다시 로그인해 주세요." }, { status: 401 }),
    });

    const response = await POST(
      new Request("http://localhost/api/payments/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: "starter" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 422 for invalid package", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });

    const response = await POST(
      new Request("http://localhost/api/payments/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: "invalid" }),
      }),
    );

    expect(response.status).toBe(422);
    expect(mockedCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("creates checkout session for valid package", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedCreateCheckoutSession.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/pay/cs_test_123",
    });

    const response = await POST(
      new Request("http://localhost/api/payments/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: "starter" }),
      }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { sessionId: string; url: string };
    expect(data.sessionId).toBe("cs_test_123");
    expect(data.url).toContain("stripe.com");
    expect(mockedCreateCheckoutSession).toHaveBeenCalledWith({
      userId: "user-1",
      packageId: "starter",
      credits: 30,
      successUrl: "http://localhost/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "http://localhost/dashboard?payment=canceled",
    });
  });
});
