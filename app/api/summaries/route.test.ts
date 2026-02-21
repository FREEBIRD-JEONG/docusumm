import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/db/repositories/summary-repository", () => ({
  listSummariesByUser: vi.fn(),
  deleteSummariesByUser: vi.fn(),
}));

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

import { deleteSummariesByUser, listSummariesByUser } from "@/db/repositories/summary-repository";
import { resolveApiUser } from "@/lib/auth/api-user";

import { DELETE, GET } from "./route";

const mockedResolveApiUser = vi.mocked(resolveApiUser);
const mockedListSummariesByUser = vi.mocked(listSummariesByUser);
const mockedDeleteSummariesByUser = vi.mocked(deleteSummariesByUser);

describe("/api/summaries route", () => {
  beforeEach(() => {
    mockedResolveApiUser.mockReset();
    mockedListSummariesByUser.mockReset();
    mockedDeleteSummariesByUser.mockReset();
  });

  it("returns auth error response from resolver", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "",
      email: null,
      errorResponse: NextResponse.json({ error: "로그인이 필요합니다. 다시 로그인해 주세요." }, { status: 401 }),
    });

    const response = await GET(new Request("http://localhost/api/summaries?limit=30"));
    expect(response.status).toBe(401);
  });

  it("lists summaries for authenticated user", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedListSummariesByUser.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost/api/summaries?limit=30"));
    expect(response.status).toBe(200);
    expect(mockedListSummariesByUser).toHaveBeenCalledWith("user-1", 30);
  });

  it("deletes authenticated user history", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedDeleteSummariesByUser.mockResolvedValue(4);

    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(mockedDeleteSummariesByUser).toHaveBeenCalledWith("user-1");

    const data = (await response.json()) as { deletedCount: number };
    expect(data.deletedCount).toBe(4);
  });
});

