import { beforeEach, describe, expect, it } from "vitest";

import { getMemoryStore } from "@/db/memory-store";

import { applyStripeCheckoutCompletedEvent } from "./billing-repository";

describe("billing-repository", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    const store = getMemoryStore();
    store.users.clear();
    store.summaries.clear();
    store.jobs.clear();
    store.creditTransactions.clear();
    store.stripeWebhookEvents.clear();
  });

  it("applies completed checkout event once and increases credits", async () => {
    const store = getMemoryStore();
    store.users.set("user-1", {
      id: "user-1",
      email: "user@example.com",
      credits: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await applyStripeCheckoutCompletedEvent({
      stripeEventId: "evt_1",
      stripeEventType: "checkout.session.completed",
      stripeSessionId: "cs_1",
      userId: "user-1",
      packageId: "starter",
      credits: 30,
    });

    expect(result.processed).toBe(true);
    expect(result.newCredits).toBe(33);
    expect(store.users.get("user-1")?.credits).toBe(33);
    expect(store.stripeWebhookEvents.size).toBe(1);
    expect(store.creditTransactions.size).toBe(1);
  });

  it("returns processed false for duplicate stripe event", async () => {
    const store = getMemoryStore();
    const now = new Date().toISOString();
    store.users.set("user-1", {
      id: "user-1",
      email: "user@example.com",
      credits: 10,
      createdAt: now,
      updatedAt: now,
    });
    store.stripeWebhookEvents.set("evt_dup", {
      id: "internal-event-1",
      stripeEventId: "evt_dup",
      eventType: "checkout.session.completed",
      stripeSessionId: "cs_dup",
      createdAt: now,
      processedAt: now,
    });

    const result = await applyStripeCheckoutCompletedEvent({
      stripeEventId: "evt_dup",
      stripeEventType: "checkout.session.completed",
      stripeSessionId: "cs_dup",
      userId: "user-1",
      packageId: "pro",
      credits: 50,
    });

    expect(result).toEqual({ processed: false });
    expect(store.users.get("user-1")?.credits).toBe(10);
    expect(store.creditTransactions.size).toBe(0);
  });

  it("returns processed false for duplicate stripe session id", async () => {
    const store = getMemoryStore();
    const now = new Date().toISOString();
    store.users.set("user-1", {
      id: "user-1",
      email: "user@example.com",
      credits: 10,
      createdAt: now,
      updatedAt: now,
    });
    store.stripeWebhookEvents.set("evt_existing", {
      id: "internal-event-2",
      stripeEventId: "evt_existing",
      eventType: "checkout.session.completed",
      stripeSessionId: "cs_same",
      createdAt: now,
      processedAt: now,
    });

    const result = await applyStripeCheckoutCompletedEvent({
      stripeEventId: "evt_new",
      stripeEventType: "checkout.session.completed",
      stripeSessionId: "cs_same",
      userId: "user-1",
      packageId: "starter",
      credits: 30,
    });

    expect(result).toEqual({ processed: false });
    expect(store.users.get("user-1")?.credits).toBe(10);
    expect(store.creditTransactions.size).toBe(0);
  });

  it("throws when target user does not exist", async () => {
    await expect(
      applyStripeCheckoutCompletedEvent({
        stripeEventId: "evt_missing_user",
        stripeEventType: "checkout.session.completed",
        stripeSessionId: "cs_missing_user",
        userId: "missing-user",
        packageId: "max",
        credits: 100,
      }),
    ).rejects.toThrow("[PAYMENT_USER_NOT_FOUND]");
  });
});
