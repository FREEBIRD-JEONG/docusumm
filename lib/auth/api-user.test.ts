import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/repositories/user-repository", () => ({
  upsertUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/runtime", () => ({
  isAuthEnabled: vi.fn(),
  getGuestUserId: vi.fn(),
  getGuestUserEmail: vi.fn(),
}));

import { upsertUserProfile } from "@/db/repositories/user-repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGuestUserEmail, getGuestUserId, isAuthEnabled } from "@/lib/auth/runtime";

import { resolveApiUser } from "./api-user";

const mockedUpsertUserProfile = vi.mocked(upsertUserProfile);
const mockedCreateSupabaseServerClient = vi.mocked(createSupabaseServerClient);
const mockedIsAuthEnabled = vi.mocked(isAuthEnabled);
const mockedGetGuestUserId = vi.mocked(getGuestUserId);
const mockedGetGuestUserEmail = vi.mocked(getGuestUserEmail);

describe("resolveApiUser", () => {
  beforeEach(() => {
    mockedUpsertUserProfile.mockReset();
    mockedCreateSupabaseServerClient.mockReset();
    mockedIsAuthEnabled.mockReset();
    mockedGetGuestUserId.mockReset();
    mockedGetGuestUserEmail.mockReset();
  });

  it("resolves guest user and ensures profile when auth is disabled", async () => {
    mockedIsAuthEnabled.mockReturnValue(false);
    mockedGetGuestUserId.mockReturnValue("guest-user");
    mockedGetGuestUserEmail.mockReturnValue("guest-user@local.invalid");

    const result = await resolveApiUser({ ensureProfile: true });

    expect(result.errorResponse).toBeNull();
    expect(result.userId).toBe("guest-user");
    expect(result.email).toBe("guest-user@local.invalid");
    expect(mockedUpsertUserProfile).toHaveBeenCalledWith({
      id: "guest-user",
      email: "guest-user@local.invalid",
    });
  });

  it("returns authenticated user when auth is enabled", async () => {
    mockedIsAuthEnabled.mockReturnValue(true);
    mockedCreateSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
          error: null,
        }),
      },
    } as never);

    const result = await resolveApiUser({ ensureProfile: true });

    expect(result.errorResponse).toBeNull();
    expect(result.userId).toBe("user-1");
    expect(result.email).toBe("user@example.com");
    expect(mockedUpsertUserProfile).toHaveBeenCalledWith({
      id: "user-1",
      email: "user@example.com",
    });
  });

  it("returns 401 when user session is unavailable", async () => {
    mockedIsAuthEnabled.mockReturnValue(true);
    mockedCreateSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("session missing"),
        }),
      },
    } as never);

    const result = await resolveApiUser();
    expect(result.errorResponse?.status).toBe(401);
    expect(result.userId).toBe("");
  });
});

