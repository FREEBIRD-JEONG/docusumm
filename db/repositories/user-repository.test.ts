import { beforeEach, describe, expect, it } from "vitest";

import { getMemoryStore } from "@/db/memory-store";

import {
  addUserCredits,
  consumeUserCredit,
  getUserProfileById,
  restoreUserCredit,
  upsertUserProfile,
} from "./user-repository";

describe("upsertUserProfile", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    const store = getMemoryStore();
    store.users.clear();
    store.summaries.clear();
    store.jobs.clear();
    store.creditTransactions.clear();
    store.stripeWebhookEvents.clear();
  });

  it("sets default credits to 3 for a new user", async () => {
    await upsertUserProfile({ id: "user-1", email: "new-user@example.com" });

    const user = getMemoryStore().users.get("user-1");
    expect(user).toBeDefined();
    expect(user?.credits).toBe(3);
    expect(user?.email).toBe("new-user@example.com");
  });

  it("preserves existing credits on re-login while updating email", async () => {
    await upsertUserProfile({ id: "user-1", email: "old@example.com" });
    const store = getMemoryStore();
    const existing = store.users.get("user-1");
    expect(existing).toBeDefined();

    store.users.set("user-1", {
      ...existing!,
      credits: 9,
    });

    await upsertUserProfile({ id: "user-1", email: "new@example.com" });

    const updated = store.users.get("user-1");
    expect(updated).toBeDefined();
    expect(updated?.credits).toBe(9);
    expect(updated?.email).toBe("new@example.com");
  });

  it("returns user profile with credits", async () => {
    await upsertUserProfile({ id: "user-2", email: "profile@example.com" });

    const profile = await getUserProfileById("user-2");

    expect(profile).toEqual({
      id: "user-2",
      email: "profile@example.com",
      credits: 3,
    });
  });

  it("consumes one credit and restores it", async () => {
    await upsertUserProfile({ id: "user-3", email: "credits@example.com" });

    const remainingCredits = await consumeUserCredit("user-3");
    expect(remainingCredits).toBe(2);

    const restoredCredits = await restoreUserCredit("user-3");
    expect(restoredCredits).toBe(3);
  });

  it("returns null when consuming credit from empty balance", async () => {
    await upsertUserProfile({ id: "user-4", email: "zero@example.com" });
    const store = getMemoryStore();
    const existing = store.users.get("user-4");
    expect(existing).toBeDefined();

    store.users.set("user-4", {
      ...existing!,
      credits: 0,
    });

    const remainingCredits = await consumeUserCredit("user-4");
    expect(remainingCredits).toBeNull();
  });

  it("adds credits with positive integer amount", async () => {
    await upsertUserProfile({ id: "user-5", email: "add-credits@example.com" });
    const updatedCredits = await addUserCredits("user-5", 30);
    expect(updatedCredits).toBe(33);
  });

  it("throws for non-positive credit amount in addUserCredits", async () => {
    await upsertUserProfile({ id: "user-6", email: "invalid-amount@example.com" });
    await expect(addUserCredits("user-6", 0)).rejects.toThrow("[INVALID_CREDIT_AMOUNT]");
    await expect(addUserCredits("user-6", -3)).rejects.toThrow("[INVALID_CREDIT_AMOUNT]");
  });
});
