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

declare global {
  var __docusummMemoryStore__:
    | {
        summaries: Map<string, MemorySummary>;
        jobs: Map<string, MemoryJob>;
        users: Map<string, MemoryUser>;
      }
    | undefined;
}

function createStore() {
  return {
    summaries: new Map<string, MemorySummary>(),
    jobs: new Map<string, MemoryJob>(),
    users: new Map<string, MemoryUser>(),
  };
}

export function getMemoryStore() {
  if (!globalThis.__docusummMemoryStore__) {
    globalThis.__docusummMemoryStore__ = createStore();
  }
  return globalThis.__docusummMemoryStore__;
}
