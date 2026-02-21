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

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    type: text("type").$type<"bonus" | "charge" | "usage">().notNull(),
    source: text("source")
      .$type<"summary_request" | "stripe_checkout" | "manual_adjustment">()
      .notNull(),
    packageId: text("package_id"),
    stripeEventId: text("stripe_event_id"),
    stripeSessionId: text("stripe_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userCreatedAtIdx: index("idx_credit_transactions_user_created_at").on(table.userId, table.createdAt),
  }),
);

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  stripeSessionId: text("stripe_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SummaryRow = typeof summaries.$inferSelect;
export type SummaryInsert = typeof summaries.$inferInsert;
export type SummaryJobRow = typeof summaryJobs.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type CreditTransactionRow = typeof creditTransactions.$inferSelect;
export type StripeWebhookEventRow = typeof stripeWebhookEvents.$inferSelect;
