"use client";

import { useEffect, useRef } from "react";

import { getSummaryById } from "@/lib/api/summary-client";
import type { SummaryRecord } from "@/types/summary";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

interface UseSummaryPollingOptions {
  summaryId: string | null;
  enabled?: boolean;
  intervalMs?: number;
  onSummaryUpdate?: (summary: SummaryRecord) => void;
  onError?: (message: string) => void;
}

export function useSummaryPolling({
  summaryId,
  enabled = true,
  intervalMs = 2000,
  onSummaryUpdate,
  onError,
}: UseSummaryPollingOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!summaryId || !enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      return;
    }

    let disposed = false;

    const poll = async () => {
      try {
        const summary = await getSummaryById(summaryId);
        onSummaryUpdate?.(summary);

        if (TERMINAL_STATUSES.has(summary.status)) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
          }
        }
      } catch (pollError) {
        if (!disposed) {
          onError?.(
            pollError instanceof Error ? pollError.message : "요약 상태를 확인하는 중 오류가 발생했습니다.",
          );
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      }
    };

    void poll();
    intervalRef.current = setInterval(() => {
      void poll();
    }, intervalMs);

    return () => {
      disposed = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, intervalMs, onError, onSummaryUpdate, summaryId]);

  return { isPolling: Boolean(summaryId && enabled) };
}
