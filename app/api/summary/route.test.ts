import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

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

import { resolveApiUser } from "@/lib/auth/api-user";
import { consumeUserCredit, restoreUserCredit } from "@/db/repositories/user-repository";
import { createSummary, enqueueSummaryJob } from "@/db/repositories/summary-repository";

import { POST } from "./route";

const mockedResolveApiUser = vi.mocked(resolveApiUser);
const mockedConsumeUserCredit = vi.mocked(consumeUserCredit);
const mockedRestoreUserCredit = vi.mocked(restoreUserCredit);
const mockedCreateSummary = vi.mocked(createSummary);
const mockedEnqueueSummaryJob = vi.mocked(enqueueSummaryJob);
const VALID_TEXT_INPUT =
  "This is a long enough test input text to pass the minimum forty characters validation rule.";

describe("/api/summary route", () => {
  beforeEach(() => {
    mockedResolveApiUser.mockReset();
    mockedConsumeUserCredit.mockReset();
    mockedRestoreUserCredit.mockReset();
    mockedCreateSummary.mockReset();
    mockedEnqueueSummaryJob.mockReset();
    delete process.env.INTERNAL_WORKER_SECRET;
    delete process.env.CRON_SECRET;
    delete process.env.AUTO_TRIGGER_WORKER_ON_SUMMARY_CREATE;
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  it("returns auth error response from resolver", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "",
      email: null,
      errorResponse: NextResponse.json({ error: "로그인이 필요합니다. 다시 로그인해 주세요." }, { status: 401 }),
    });

    const response = await POST(
      new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content: VALID_TEXT_INPUT,
        }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 402 when user has no credits", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedConsumeUserCredit.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content: VALID_TEXT_INPUT,
        }),
      }),
    );

    expect(response.status).toBe(402);
    expect(mockedCreateSummary).not.toHaveBeenCalled();
  });

  it("creates summary and returns remaining credits", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedConsumeUserCredit.mockResolvedValue(2);
    mockedCreateSummary.mockResolvedValue({
      id: "summary-1",
      userId: "user-1",
      sourceType: "text",
      originalContent: VALID_TEXT_INPUT,
      summaryText: null,
      status: "pending",
      errorMessage: null,
      createdAt: "2026-02-19T00:00:00.000Z",
      updatedAt: "2026-02-19T00:00:00.000Z",
    });
    mockedEnqueueSummaryJob.mockResolvedValue(undefined);

    const response = await POST(
      new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content: VALID_TEXT_INPUT,
        }),
      }),
    );

    expect(response.status).toBe(202);
    const data = (await response.json()) as { remainingCredits?: number };
    expect(data.remainingCredits).toBe(2);
    expect(mockedCreateSummary).toHaveBeenCalledOnce();
  });

  it("restores credit when summary creation fails after charge", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedConsumeUserCredit.mockResolvedValue(2);
    mockedCreateSummary.mockRejectedValue(new Error("db unavailable"));
    mockedRestoreUserCredit.mockResolvedValue(3);

    const response = await POST(
      new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content: VALID_TEXT_INPUT,
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(mockedRestoreUserCredit).toHaveBeenCalledWith("user-1");
  });

  it("auto triggers worker without auth headers when secrets are missing", async () => {
    const fetchMock = vi.mocked(fetch);

    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedConsumeUserCredit.mockResolvedValue(2);
    mockedCreateSummary.mockResolvedValue({
      id: "summary-1",
      userId: "user-1",
      sourceType: "text",
      originalContent: VALID_TEXT_INPUT,
      summaryText: null,
      status: "pending",
      errorMessage: null,
      createdAt: "2026-02-19T00:00:00.000Z",
      updatedAt: "2026-02-19T00:00:00.000Z",
    });
    mockedEnqueueSummaryJob.mockResolvedValue(undefined);

    const response = await POST(
      new Request("https://docusumm-xi.vercel.app/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content: VALID_TEXT_INPUT,
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined();
  });

  it("auto triggers worker with CRON_SECRET when worker secret is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.CRON_SECRET = "cron-secret";

    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedConsumeUserCredit.mockResolvedValue(2);
    mockedCreateSummary.mockResolvedValue({
      id: "summary-1",
      userId: "user-1",
      sourceType: "text",
      originalContent: VALID_TEXT_INPUT,
      summaryText: null,
      status: "pending",
      errorMessage: null,
      createdAt: "2026-02-19T00:00:00.000Z",
      updatedAt: "2026-02-19T00:00:00.000Z",
    });
    mockedEnqueueSummaryJob.mockResolvedValue(undefined);

    const response = await POST(
      new Request("https://docusumm-xi.vercel.app/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content: VALID_TEXT_INPUT,
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://docusumm-xi.vercel.app/api/internal/summary-worker");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cron-secret");
  });
});
