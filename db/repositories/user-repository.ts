import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { getMemoryStore } from "@/db/memory-store";
import { users } from "@/db/schema";

interface UpsertUserProfileInput {
  id: string;
  email: string;
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
