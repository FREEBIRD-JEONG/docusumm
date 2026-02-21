import { desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { getMemoryStore, type MemoryJob, type MemorySummary } from "@/db/memory-store";
import { summaryJobs, summaries, type SummaryRow, users } from "@/db/schema";
import type { SourceType, SummaryRecord } from "@/types/summary";

const SUMMARY_CANCELED_CODE = "SUMMARY_CANCELED";
const SUMMARY_CANCELED_MESSAGE = `[${SUMMARY_CANCELED_CODE}] 사용자 요청으로 요약이 취소되었습니다.`;

interface CreateSummaryInput {
  sourceType: SourceType;
  originalContent: string;
  userId: string;
}

interface ClaimedJob {
  jobId: string;
  summaryId: string;
  attemptCount: number;
  sourceType: SourceType;
  originalContent: string;
}

export interface FailSummaryJobResult {
  terminal: boolean;
  canceledByUser: boolean;
  userId: string | null;
}

function isCanceledMessage(errorMessage: string | null | undefined): boolean {
  return typeof errorMessage === "string" && errorMessage.includes(`[${SUMMARY_CANCELED_CODE}]`);
}

function toSummaryRecord(row: SummaryRow): SummaryRecord {
  return {
    id: row.id,
    userId: row.userId,
    sourceType: row.sourceType,
    originalContent: row.originalContent,
    summaryText: row.summaryText,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }

  return [];
}

function mapMemorySummary(summary: MemorySummary): SummaryRecord {
  return {
    id: summary.id,
    userId: summary.userId,
    sourceType: summary.sourceType,
    originalContent: summary.originalContent,
    summaryText: summary.summaryText,
    status: summary.status,
    errorMessage: summary.errorMessage,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

export async function createSummary(input: CreateSummaryInput): Promise<SummaryRecord> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    store.summaries.set(id, {
      id,
      userId: input.userId,
      sourceType: input.sourceType,
      originalContent: input.originalContent,
      summaryText: null,
      status: "pending",
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    return mapMemorySummary(store.summaries.get(id)!);
  }

  const [created] = await db
    .insert(summaries)
    .values({
      userId: input.userId,
      sourceType: input.sourceType,
      originalContent: input.originalContent,
      summaryText: null,
      status: "pending",
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return toSummaryRecord(created);
}

export async function enqueueSummaryJob(summaryId: string): Promise<void> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const now = new Date().toISOString();
    const job: MemoryJob = {
      id: crypto.randomUUID(),
      summaryId,
      status: "queued",
      attemptCount: 0,
      scheduledAt: now,
      lockedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    store.jobs.set(job.id, job);
    return;
  }

  await db.insert(summaryJobs).values({
    summaryId,
    status: "queued",
    attemptCount: 0,
    scheduledAt: new Date(),
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function getSummaryById(
  summaryId: string,
  userId: string,
): Promise<SummaryRecord | null> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const memorySummary = store.summaries.get(summaryId);
    if (!memorySummary || memorySummary.userId !== userId) {
      return null;
    }
    return mapMemorySummary(memorySummary);
  }

  const [row] = await db
    .select()
    .from(summaries)
    .where(sql`${summaries.id} = ${summaryId} AND ${summaries.userId} = ${userId}`)
    .limit(1);
  if (!row) {
    return null;
  }
  return toSummaryRecord(row);
}

export async function getSummaryOwnerEmail(summaryId: string): Promise<string | null> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const summary = store.summaries.get(summaryId);
    if (!summary?.userId) {
      return null;
    }
    return store.users.get(summary.userId)?.email ?? null;
  }

  const [row] = await db
    .select({
      email: users.email,
    })
    .from(summaries)
    .leftJoin(users, eq(summaries.userId, users.id))
    .where(eq(summaries.id, summaryId))
    .limit(1);

  return row?.email ?? null;
}

export async function claimSummaryJobs(limit: number): Promise<ClaimedJob[]> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const now = Date.now();
    const queuedJobs = Array.from(store.jobs.values())
      .filter((job) => {
        if (job.status !== "queued" || new Date(job.scheduledAt).getTime() > now) {
          return false;
        }
        const summary = store.summaries.get(job.summaryId);
        return summary?.status === "pending";
      })
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .slice(0, limit);

    return queuedJobs
      .map((job) => {
        const summary = store.summaries.get(job.summaryId);
        if (!summary) {
          return null;
        }
        const updatedAt = new Date().toISOString();
        job.status = "processing";
        job.lockedAt = updatedAt;
        job.updatedAt = updatedAt;
        job.attemptCount += 1;
        store.jobs.set(job.id, job);
        return {
          jobId: job.id,
          summaryId: job.summaryId,
          attemptCount: job.attemptCount,
          sourceType: summary.sourceType,
          originalContent: summary.originalContent,
        };
      })
      .filter((value): value is ClaimedJob => Boolean(value));
  }

  type ClaimedJobRow = { jobId: string; summaryId: string; attemptCount: number };

  const claimResult = await db.execute(sql<ClaimedJobRow>`
    WITH picked AS (
      SELECT id
      FROM summary_jobs
      WHERE status = 'queued'
        AND scheduled_at <= NOW()
        AND EXISTS (
          SELECT 1
          FROM summaries s
          WHERE s.id = summary_jobs.summary_id
            AND s.status = 'pending'
        )
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE summary_jobs AS sj
    SET
      status = 'processing',
      locked_at = NOW(),
      updated_at = NOW(),
      attempt_count = sj.attempt_count + 1
    FROM picked
    WHERE sj.id = picked.id
    RETURNING
      sj.id AS "jobId",
      sj.summary_id AS "summaryId",
      sj.attempt_count AS "attemptCount";
  `);

  const claimedRows = extractRows<ClaimedJobRow>(claimResult);
  if (claimedRows.length === 0) {
    return [];
  }

  const summaryRows = await db
    .select({
      id: summaries.id,
      sourceType: summaries.sourceType,
      originalContent: summaries.originalContent,
    })
    .from(summaries)
    .where(inArray(summaries.id, claimedRows.map((row) => row.summaryId)));

  return claimedRows
    .map((row) => {
      const summary = summaryRows.find((item) => item.id === row.summaryId);
      if (!summary) {
        return null;
      }
      return {
        jobId: row.jobId,
        summaryId: row.summaryId,
        attemptCount: row.attemptCount,
        sourceType: summary.sourceType,
        originalContent: summary.originalContent,
      };
    })
    .filter((value): value is ClaimedJob => Boolean(value));
}

export async function markSummaryProcessing(summaryId: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const summary = store.summaries.get(summaryId);
    if (!summary || summary.status !== "pending") {
      return false;
    }
    summary.status = "processing";
    summary.updatedAt = new Date().toISOString();
    store.summaries.set(summaryId, summary);
    return true;
  }

  const updated = await db
    .update(summaries)
    .set({ status: "processing", updatedAt: new Date(), errorMessage: null })
    .where(sql`${summaries.id} = ${summaryId} AND ${summaries.status} = 'pending'`)
    .returning({ id: summaries.id });

  return updated.length > 0;
}

export async function completeSummaryJob(
  summaryId: string,
  jobId: string,
  summaryText: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const summary = store.summaries.get(summaryId);
    const job = store.jobs.get(jobId);
    if (!summary || !job) {
      return false;
    }
    if (summary.status !== "processing") {
      const now = new Date().toISOString();
      job.status = "failed";
      job.lockedAt = null;
      job.updatedAt = now;
      store.jobs.set(jobId, job);
      return false;
    }
    const now = new Date().toISOString();
    summary.status = "completed";
    summary.summaryText = summaryText;
    summary.errorMessage = null;
    summary.updatedAt = now;
    job.status = "completed";
    job.lockedAt = null;
    job.updatedAt = now;
    store.summaries.set(summaryId, summary);
    store.jobs.set(jobId, job);
    return true;
  }

  return db.transaction(async (tx) => {
    const updatedSummary = await tx
      .update(summaries)
      .set({
        status: "completed",
        summaryText,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(sql`${summaries.id} = ${summaryId} AND ${summaries.status} = 'processing'`)
      .returning({ id: summaries.id });

    if (updatedSummary.length === 0) {
      await tx
        .update(summaryJobs)
        .set({
          status: "failed",
          scheduledAt: new Date(),
          lockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(summaryJobs.id, jobId));
      return false;
    }

    await tx
      .update(summaryJobs)
      .set({
        status: "completed",
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(summaryJobs.id, jobId));
    return true;
  });
}

export async function failSummaryJob(params: {
  summaryId: string;
  jobId: string;
  attemptCount: number;
  errorMessage: string;
  maxAttempts: number;
}): Promise<FailSummaryJobResult> {
  const { summaryId, jobId, attemptCount, errorMessage, maxAttempts } = params;
  const shouldRetryByAttempts = attemptCount < maxAttempts;
  const nextAttemptDate = new Date(Date.now() + 30 * 1000);

  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const summary = store.summaries.get(summaryId);
    const job = store.jobs.get(jobId);
    if (!summary || !job) {
      return {
        terminal: false,
        canceledByUser: false,
        userId: null,
      };
    }
    const now = new Date().toISOString();
    const canceledByUser = isCanceledMessage(summary.errorMessage);
    const shouldRetry = shouldRetryByAttempts && !canceledByUser;

    if (shouldRetry) {
      summary.status = "pending";
      job.status = "queued";
      job.scheduledAt = nextAttemptDate.toISOString();
    } else {
      summary.status = "failed";
      job.status = "failed";
      job.scheduledAt = now;
    }
    if (!canceledByUser) {
      summary.errorMessage = errorMessage;
    }
    summary.updatedAt = now;
    job.lockedAt = null;
    job.updatedAt = now;
    store.summaries.set(summaryId, summary);
    store.jobs.set(jobId, job);
    return {
      terminal: !shouldRetry,
      canceledByUser,
      userId: summary.userId ?? null,
    };
  }

  return db.transaction(async (tx) => {
    const current = await tx
      .select({
        status: summaries.status,
        errorMessage: summaries.errorMessage,
        userId: summaries.userId,
      })
      .from(summaries)
      .where(eq(summaries.id, summaryId))
      .limit(1);

    const currentSummary = current[0];
    if (!currentSummary) {
      return {
        terminal: false,
        canceledByUser: false,
        userId: null,
      };
    }

    const canceledByUser =
      currentSummary?.status === "failed" && isCanceledMessage(currentSummary.errorMessage);
    const shouldRetry = shouldRetryByAttempts && !canceledByUser;

    await tx
      .update(summaries)
      .set({
        status: shouldRetry ? "pending" : "failed",
        errorMessage: canceledByUser ? SUMMARY_CANCELED_MESSAGE : errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(summaries.id, summaryId));

    await tx
      .update(summaryJobs)
      .set({
        status: shouldRetry ? "queued" : "failed",
        scheduledAt: shouldRetry ? nextAttemptDate : new Date(),
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(summaryJobs.id, jobId));

    return {
      terminal: !shouldRetry,
      canceledByUser,
      userId: currentSummary.userId ?? null,
    };
  });
}

export async function cancelSummary(
  summaryId: string,
  userId: string,
): Promise<SummaryRecord | null> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const summary = store.summaries.get(summaryId);
    if (!summary || summary.userId !== userId) {
      return null;
    }

    if (summary.status === "pending" || summary.status === "processing") {
      const now = new Date().toISOString();
      summary.status = "failed";
      summary.errorMessage = SUMMARY_CANCELED_MESSAGE;
      summary.updatedAt = now;
      store.summaries.set(summaryId, summary);

      for (const job of store.jobs.values()) {
        if (job.summaryId !== summaryId) {
          continue;
        }

        if (job.status === "queued" || job.status === "processing") {
          job.status = "failed";
          job.scheduledAt = now;
          job.lockedAt = null;
          job.updatedAt = now;
          store.jobs.set(job.id, job);
        }
      }
    }

    return mapMemorySummary(summary);
  }

  const result = await db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(summaries)
      .set({
        status: "failed",
        errorMessage: SUMMARY_CANCELED_MESSAGE,
        updatedAt: new Date(),
      })
      .where(
        sql`${summaries.id} = ${summaryId}
        AND ${summaries.userId} = ${userId}
        AND ${summaries.status} IN ('pending', 'processing')`,
      )
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      const existing = await tx
        .select()
        .from(summaries)
        .where(sql`${summaries.id} = ${summaryId} AND ${summaries.userId} = ${userId}`)
        .limit(1);
      return existing[0] ?? null;
    }

    await tx
      .update(summaryJobs)
      .set({
        status: "failed",
        scheduledAt: new Date(),
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(
        sql`${summaryJobs.summaryId} = ${summaryId}
        AND ${summaryJobs.status} IN ('queued', 'processing')`,
      );

    return updated;
  });

  if (!result) {
    return null;
  }
  return toSummaryRecord(result);
}

export async function listSummariesByUser(userId: string, limit = 30): Promise<SummaryRecord[]> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    return Array.from(store.summaries.values())
      .filter((summary) => summary.userId === userId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, limit)
      .map(mapMemorySummary);
  }

  const rows = await db
    .select()
    .from(summaries)
    .where(eq(summaries.userId, userId))
    .orderBy(desc(summaries.createdAt))
    .limit(limit);

  return rows.map(toSummaryRecord);
}

export async function deleteSummariesByUser(userId: string): Promise<number> {
  const db = getDb();
  if (!db) {
    const store = getMemoryStore();
    const summaryIds = Array.from(store.summaries.values())
      .filter((summary) => summary.userId === userId)
      .map((summary) => summary.id);
    const summaryIdSet = new Set(summaryIds);

    for (const summaryId of summaryIds) {
      store.summaries.delete(summaryId);
    }

    for (const job of Array.from(store.jobs.values())) {
      if (summaryIdSet.has(job.summaryId)) {
        store.jobs.delete(job.id);
      }
    }

    return summaryIds.length;
  }

  const deletedRows = await db
    .delete(summaries)
    .where(eq(summaries.userId, userId))
    .returning({ id: summaries.id });

  return deletedRows.length;
}
