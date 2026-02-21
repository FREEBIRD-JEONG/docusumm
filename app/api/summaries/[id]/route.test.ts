import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/db/repositories/summary-repository", () => ({
  getSummaryById: vi.fn(),
}));

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

import { getSummaryById } from "@/db/repositories/summary-repository";
import { resolveApiUser } from "@/lib/auth/api-user";

import { GET } from "./route";

const mockedGetSummaryById = vi.mocked(getSummaryById);
const mockedResolveApiUser = vi.mocked(resolveApiUser);

describe("/api/summaries/[id] route", () => {
  beforeEach(() => {
    mockedGetSummaryById.mockReset();
    mockedResolveApiUser.mockReset();
  });

  it("returns auth error response from resolver", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "",
      email: null,
      errorResponse: NextResponse.json({ error: "로그인이 필요합니다. 다시 로그인해 주세요." }, { status: 401 }),
    });

    const response = await GET(new Request("http://localhost/api/summaries/summary-1"), {
      params: Promise.resolve({ id: "summary-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when summary does not belong to current user", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedGetSummaryById.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/summaries/summary-1"), {
      params: Promise.resolve({ id: "summary-1" }),
    });

    expect(response.status).toBe(404);
    expect(mockedGetSummaryById).toHaveBeenCalledWith("summary-1", "user-1");
  });
});

