import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { getMemoryStore } from "@/db/memory-store";
import { users } from "@/db/schema";

interface UpsertUserProfileInput {
  id: string;
  email: string;
}

export interface UserProfile {
  id: string;
  email: string;
  credits: number;
}

export async function upsertUserProfile(input: UpsertUserProfileInput): Promise<void> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const now = new Date().toISOString();
    const existing = store.users.get(input.id);

    store.users.set(input.id, {
      id: input.id,
      email: input.email,
      credits: existing?.credits ?? 3,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return;
  }

  const now = new Date();
  const existing = await db.select().from(users).where(eq(users.id, input.id)).limit(1);

  if (existing.length > 0) {
    await db
      .update(users)
      .set({
        email: input.email,
        updatedAt: now,
      })
      .where(eq(users.id, input.id));
    return;
  }

  await db.insert(users).values({
    id: input.id,
    email: input.email,
    credits: 3,
    createdAt: now,
    updatedAt: now,
  });
}

export async function getUserProfileById(userId: string): Promise<UserProfile | null> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const user = store.users.get(userId);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      credits: user.credits,
    };
  }

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      credits: users.credits,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    return null;
  }

  return row;
}

export async function consumeUserCredit(userId: string): Promise<number | null> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const user = store.users.get(userId);
    if (!user || user.credits <= 0) {
      return null;
    }

    user.credits -= 1;
    user.updatedAt = new Date().toISOString();
    store.users.set(userId, user);
    return user.credits;
  }

  const [row] = await db
    .update(users)
    .set({
      credits: sql<number>`${users.credits} - 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, userId), gt(users.credits, 0)))
    .returning({ credits: users.credits });

  if (!row) {
    return null;
  }

  return row.credits;
}

export async function restoreUserCredit(userId: string): Promise<number | null> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const user = store.users.get(userId);
    if (!user) {
      return null;
    }

    user.credits += 1;
    user.updatedAt = new Date().toISOString();
    store.users.set(userId, user);
    return user.credits;
  }

  const [row] = await db
    .update(users)
    .set({
      credits: sql<number>`${users.credits} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ credits: users.credits });

  if (!row) {
    return null;
  }

  return row.credits;
}

export async function addUserCredits(userId: string, amount: number): Promise<number | null> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("[INVALID_CREDIT_AMOUNT] amount must be a positive integer.");
  }

  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const user = store.users.get(userId);
    if (!user) {
      return null;
    }

    user.credits += amount;
    user.updatedAt = new Date().toISOString();
    store.users.set(userId, user);
    return user.credits;
  }

  const [row] = await db
    .update(users)
    .set({
      credits: sql<number>`${users.credits} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ credits: users.credits });

  if (!row) {
    return null;
  }

  return row.credits;
}
