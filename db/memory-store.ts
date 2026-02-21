import type { SourceType, SummaryJobStatus, SummaryStatus } from "@/types/summary";

export interface MemorySummary {
  id: string;
  userId: string | null;
  sourceType: SourceType;
  originalContent: string;
  summaryText: string | null;
  status: SummaryStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryJob {
  id: string;
  summaryId: string;
  status: SummaryJobStatus;
  attemptCount: number;
  scheduledAt: string;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryUser {
  id: string;
  email: string;
  credits: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryCreditTransaction {
  id: string;
  userId: string;
  amount: number;
  type: "bonus" | "charge" | "usage";
  source: "summary_request" | "stripe_checkout" | "manual_adjustment";
  packageId: string | null;
  stripeEventId: string | null;
  stripeSessionId: string | null;
  createdAt: string;
}

export interface MemoryStripeWebhookEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  stripeSessionId: string | null;
  createdAt: string;
  processedAt: string;
}

declare global {
  var __docusummMemoryStore__:
    | {
        summaries: Map<string, MemorySummary>;
        jobs: Map<string, MemoryJob>;
        users: Map<string, MemoryUser>;
        creditTransactions: Map<string, MemoryCreditTransaction>;
        stripeWebhookEvents: Map<string, MemoryStripeWebhookEvent>;
      }
    | undefined;
}

function createStore() {
  return {
    summaries: new Map<string, MemorySummary>(),
    jobs: new Map<string, MemoryJob>(),
    users: new Map<string, MemoryUser>(),
    creditTransactions: new Map<string, MemoryCreditTransaction>(),
    stripeWebhookEvents: new Map<string, MemoryStripeWebhookEvent>(),
  };
}

export function getMemoryStore() {
  if (!globalThis.__docusummMemoryStore__) {
    globalThis.__docusummMemoryStore__ = createStore();
  }
  return globalThis.__docusummMemoryStore__;
}
