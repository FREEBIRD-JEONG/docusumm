import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/auth/api-user", () => ({
  resolveApiUser: vi.fn(),
}));

vi.mock("@/db/repositories/user-repository", () => ({
  getUserProfileById: vi.fn(),
}));

import { getUserProfileById } from "@/db/repositories/user-repository";
import { resolveApiUser } from "@/lib/auth/api-user";

import { GET } from "./route";

const mockedResolveApiUser = vi.mocked(resolveApiUser);
const mockedGetUserProfileById = vi.mocked(getUserProfileById);

describe("/api/account route", () => {
  beforeEach(() => {
    mockedResolveApiUser.mockReset();
    mockedGetUserProfileById.mockReset();
  });

  it("returns auth error response from resolver", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "",
      email: null,
      errorResponse: NextResponse.json({ error: "로그인이 필요합니다. 다시 로그인해 주세요." }, { status: 401 }),
    });

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns profile with credits for authenticated user", async () => {
    mockedResolveApiUser.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      errorResponse: null,
    });
    mockedGetUserProfileById.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      credits: 3,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(mockedGetUserProfileById).toHaveBeenCalledWith("user-1");

    const data = (await response.json()) as { credits: number; email: string };
    expect(data.credits).toBe(3);
    expect(data.email).toBe("user@example.com");
  });
});
