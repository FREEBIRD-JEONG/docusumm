import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { getMemoryStore } from "@/db/memory-store";
import { creditTransactions, stripeWebhookEvents, users } from "@/db/schema";
import type { CreditPackageId } from "@/lib/stripe/packages";

export interface ApplyStripeCheckoutCompletedEventInput {
  stripeEventId: string;
  stripeEventType: string;
  stripeSessionId: string;
  userId: string;
  packageId: CreditPackageId;
  credits: number;
}

export interface ApplyStripeCheckoutCompletedEventResult {
  processed: boolean;
  newCredits?: number;
}

function validateCredits(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("[PAYMENT_CREDITS_INVALID] credits must be a positive integer.");
  }
}

export async function applyStripeCheckoutCompletedEvent(
  input: ApplyStripeCheckoutCompletedEventInput,
): Promise<ApplyStripeCheckoutCompletedEventResult> {
  validateCredits(input.credits);

  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    if (store.stripeWebhookEvents.has(input.stripeEventId)) {
      return { processed: false };
    }
    for (const item of store.stripeWebhookEvents.values()) {
      if (item.stripeSessionId === input.stripeSessionId) {
        return { processed: false };
      }
    }

    const user = store.users.get(input.userId);
    if (!user) {
      throw new Error("[PAYMENT_USER_NOT_FOUND] 결제 사용자 정보를 찾을 수 없습니다.");
    }

    const now = new Date().toISOString();
    user.credits += input.credits;
    user.updatedAt = now;
    store.users.set(user.id, user);

    const webhookEventId = crypto.randomUUID();
    store.stripeWebhookEvents.set(input.stripeEventId, {
      id: webhookEventId,
      stripeEventId: input.stripeEventId,
      eventType: input.stripeEventType,
      stripeSessionId: input.stripeSessionId,
      createdAt: now,
      processedAt: now,
    });

    const transactionId = crypto.randomUUID();
    store.creditTransactions.set(transactionId, {
      id: transactionId,
      userId: input.userId,
      amount: input.credits,
      type: "charge",
      source: "stripe_checkout",
      packageId: input.packageId,
      stripeEventId: input.stripeEventId,
      stripeSessionId: input.stripeSessionId,
      createdAt: now,
    });

    return {
      processed: true,
      newCredits: user.credits,
    };
  }

  return db.transaction(async (tx) => {
    const existingBySession = await tx
      .select({ id: stripeWebhookEvents.id })
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.stripeSessionId, input.stripeSessionId))
      .limit(1);

    if (existingBySession.length > 0) {
      return { processed: false };
    }

    const insertedEvent = await tx
      .insert(stripeWebhookEvents)
      .values({
        stripeEventId: input.stripeEventId,
        eventType: input.stripeEventType,
        stripeSessionId: input.stripeSessionId,
        createdAt: new Date(),
        processedAt: new Date(),
      })
      .onConflictDoNothing({ target: stripeWebhookEvents.stripeEventId })
      .returning({ id: stripeWebhookEvents.id });

    if (insertedEvent.length === 0) {
      return { processed: false };
    }

    const [updatedUser] = await tx
      .update(users)
      .set({
        credits: sql<number>`${users.credits} + ${input.credits}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId))
      .returning({ credits: users.credits });

    if (!updatedUser) {
      throw new Error("[PAYMENT_USER_NOT_FOUND] 결제 사용자 정보를 찾을 수 없습니다.");
    }

    await tx.insert(creditTransactions).values({
      userId: input.userId,
      amount: input.credits,
      type: "charge",
      source: "stripe_checkout",
      packageId: input.packageId,
      stripeEventId: input.stripeEventId,
      stripeSessionId: input.stripeSessionId,
      createdAt: new Date(),
    });

    return {
      processed: true,
      newCredits: updatedUser.credits,
    };
  });
}
