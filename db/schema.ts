import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  credits: integer("credits").default(3).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const summaries = pgTable(
  "summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    sourceType: text("source_type").$type<"text" | "youtube">().notNull(),
    originalContent: text("original_content").notNull(),
    summaryText: text("summary_text"),
    status: text("status").$type<"pending" | "processing" | "completed" | "failed">().notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userCreatedAtIdx: index("idx_summaries_user_created_at").on(table.userId, table.createdAt),
  }),
);

export const summaryJobs = pgTable("summary_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  summaryId: uuid("summary_id")
    .notNull()
    .references(() => summaries.id, { onDelete: "cascade" }),
  status: text("status").$type<"queued" | "processing" | "completed" | "failed">().notNull(),
  attemptCount: integer("attempt_count").default(0).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SummaryRow = typeof summaries.$inferSelect;
export type SummaryInsert = typeof summaries.$inferInsert;
export type SummaryJobRow = typeof summaryJobs.$inferSelect;
export type UserRow = typeof users.$inferSelect;
