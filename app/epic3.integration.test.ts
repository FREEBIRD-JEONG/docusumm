import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { SummaryRecord } from "@/types/summary";

vi.mock("@/lib/auth/runtime", () => ({
  isAuthEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: vi.fn(() => ({
    url: "https://supabase.local",
    publishableKey: "publishable-key",
  })),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

vi.mock("@/db/repositories/summary-repository", () => ({
  createSummary: vi.fn(),
  enqueueSummaryJob: vi.fn(),
  listSummariesByUser: vi.fn(),
  deleteSummariesByUser: vi.fn(),
}));

vi.mock("@/db/repositories/user-repository", () => ({
  consumeUserCredit: vi.fn(),
  restoreUserCredit: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveApiUser } from "@/lib/auth/api-user";
import {
  createSummary,
  deleteSummariesByUser,
  enqueueSummaryJob,
  listSummariesByUser,
} from "@/db/repositories/summary-repository";
import { consumeUserCredit, restoreUserCredit } from "@/db/repositories/user-repository";
import { updateSession } from "@/lib/supabase/middleware";
import { GET as callbackGet } from "@/app/auth/callback/route";
import { POST as createSummaryPost } from "@/app/api/summary/route";
import { DELETE as deleteSummaries, GET as listSummaries } from "@/app/api/summaries/route";

const mockedCreateServerClient = vi.mocked(createServerClient);
const mockedCreateSupabaseServerClient = vi.mocked(createSupabaseServerClient);
const mockedResolveApiUser = vi.mocked(resolveApiUser);
const mockedCreateSummary = vi.mocked(createSummary);
const mockedEnqueueSummaryJob = vi.mocked(enqueueSummaryJob);
const mockedListSummariesByUser = vi.mocked(listSummariesByUser);
const mockedDeleteSummariesByUser = vi.mocked(deleteSummariesByUser);
const mockedConsumeUserCredit = vi.mocked(consumeUserCredit);
const mockedRestoreUserCredit = vi.mocked(restoreUserCredit);

const USER_ID = "user-epic3";
const USER_EMAIL = "epic3@example.com";
const nowIso = "2026-02-19T06:00:00.000Z";

function buildSummaryRecord(id: string, content: string): SummaryRecord {
  return {
    id,
    userId: USER_ID,
    sourceType: "text",
    originalContent: content,
    summaryText: null,
    status: "pending",
    errorMessage: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

describe("Epic 3 integrated scenario", () => {
  const summaryStore = new Map<string, SummaryRecord>();
  let summarySeq = 0;

  beforeEach(() => {
    summaryStore.clear();
    summarySeq = 0;

    mockedCreateServerClient.mockReset();
    mockedCreateSupabaseServerClient.mockReset();
    mockedResolveApiUser.mockReset();
    mockedCreateSummary.mockReset();
    mockedEnqueueSummaryJob.mockReset();
    mockedListSummariesByUser.mockReset();
    mockedDeleteSummariesByUser.mockReset();
    mockedConsumeUserCredit.mockReset();
    mockedRestoreUserCredit.mockReset();

    delete process.env.INTERNAL_WORKER_SECRET;
    delete process.env.AUTO_TRIGGER_WORKER_ON_SUMMARY_CREATE;

    mockedCreateSummary.mockImplementation(async ({ originalContent }) => {
      summarySeq += 1;
      const id = `sum-${summarySeq}`;
      const record = buildSummaryRecord(id, originalContent);
      summaryStore.set(id, record);
      return record;
    });

    mockedEnqueueSummaryJob.mockResolvedValue(undefined);
    mockedConsumeUserCredit.mockResolvedValue(2);
    mockedRestoreUserCredit.mockResolvedValue(3);

    mockedListSummariesByUser.mockImplementation(async (userId) =>
      Array.from(summaryStore.values()).filter((item) => item.userId === userId),
    );

    mockedDeleteSummariesByUser.mockImplementation(async (userId) => {
      let deletedCount = 0;
      for (const [id, item] of summaryStore.entries()) {
        if (item.userId === userId) {
          summaryStore.delete(id);
          deletedCount += 1;
        }
      }
      return deletedCount;
    });
  });

  it("blocks unauthenticated protected page access", async () => {
    mockedCreateServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as never);

    const request = new NextRequest("http://localhost/dashboard?tab=youtube");
    const response = await updateSession(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("http://localhost/login");
    expect(location).toContain("next=%2Fdashboard%3Ftab%3Dyoutube");
  });

  it("completes oauth callback redirect to requested next path", async () => {
    mockedCreateSupabaseServerClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    } as never);
    mockedResolveApiUser.mockResolvedValue({
      userId: USER_ID,
      email: USER_EMAIL,
      errorResponse: null,
    });

    const request = new NextRequest("http://localhost/auth/callback?code=test-code&next=/dashboard");
    const response = await callbackGet(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
    expect(mockedResolveApiUser).toHaveBeenCalledWith({ ensureProfile: true });
  });

  it("creates summary then lists and deletes user history", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: USER_ID,
      email: USER_EMAIL,
      errorResponse: null,
    });

    const createResponse = await createSummaryPost(
      new Request("http://localhost/api/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "text",
          content:
            "Epic 3 integration summary content is long enough for the minimum text length rule.",
        }),
      }),
    );

    expect(createResponse.status).toBe(202);
    const createData = (await createResponse.json()) as { id: string };
    expect(createData.id).toBe("sum-1");

    const listResponse = await listSummaries(new Request("http://localhost/api/summaries?limit=30"));
    expect(listResponse.status).toBe(200);
    const listData = (await listResponse.json()) as { items: SummaryRecord[] };
    expect(listData.items).toHaveLength(1);
    expect(listData.items[0]?.id).toBe("sum-1");

    const deleteResponse = await deleteSummaries();
    expect(deleteResponse.status).toBe(200);
    const deleteData = (await deleteResponse.json()) as { deletedCount: number };
    expect(deleteData.deletedCount).toBe(1);

    const listAfterDelete = await listSummaries(new Request("http://localhost/api/summaries?limit=30"));
    const listAfterDeleteData = (await listAfterDelete.json()) as { items: SummaryRecord[] };
    expect(listAfterDeleteData.items).toHaveLength(0);
  });
});
