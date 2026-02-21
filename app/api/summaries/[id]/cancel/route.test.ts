import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/db/repositories/summary-repository", () => ({
  getSummaryById: vi.fn(),
  cancelSummary: vi.fn(),
}));

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

import { cancelSummary, getSummaryById } from "@/db/repositories/summary-repository";
import { resolveApiUser } from "@/lib/auth/api-user";

import { POST } from "./route";

const mockedGetSummaryById = vi.mocked(getSummaryById);
const mockedCancelSummary = vi.mocked(cancelSummary);
const mockedResolveApiUser = vi.mocked(resolveApiUser);

describe("/api/summaries/[id]/cancel route", () => {
  beforeEach(() => {
    mockedGetSummaryById.mockReset();
    mockedCancelSummary.mockReset();
    mockedResolveApiUser.mockReset();
  });

  it("returns auth error response from resolver", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "",
      email: null,
      errorResponse: NextResponse.json({ error: "로그인이 필요합니다. 다시 로그인해 주세요." }, { status: 401 }),
    });

    const response = await POST(new Request("http://localhost/api/summaries/summary-1/cancel"), {
      params: Promise.resolve({ id: "summary-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when summary is not accessible by user", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedGetSummaryById.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/summaries/summary-1/cancel"), {
      params: Promise.resolve({ id: "summary-1" }),
    });

    expect(response.status).toBe(404);
    expect(mockedCancelSummary).not.toHaveBeenCalled();
  });
});

