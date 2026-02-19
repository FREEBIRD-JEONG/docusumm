"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, LoaderCircle, LogOut, Menu } from "lucide-react";

import { HistoryList } from "@/components/history-list";
import { InputPanel } from "@/components/input-panel";
import { EmptyState } from "@/components/states/empty-state";
import { LoadingState } from "@/components/states/loading-state";
import { SummaryCard } from "@/components/summary-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToastStack, type ToastMessage, type ToastTone } from "@/components/ui/toast-stack";
import { useSummaryPolling } from "@/hooks/use-summary-polling";
import { extractErrorCode } from "@/lib/errors/error-messages";
import { isAuthEnabled } from "@/lib/auth/runtime";
import {
  cancelSummaryRequest,
  createSummaryRequest,
  getRecentSummaries,
} from "@/lib/api/summary-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { SourceType, SummaryRecord } from "@/types/summary";

function sortByLatest(items: SummaryRecord[]): SummaryRecord[] {
  return [...items].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function upsertSummary(items: SummaryRecord[], next: SummaryRecord): SummaryRecord[] {
  const filtered = items.filter((item) => item.id !== next.id);
  return sortByLatest([next, ...filtered]);
}

function buildPendingSummary(id: string, sourceType: SourceType, content: string): SummaryRecord {
  const now = new Date().toISOString();
  return {
    id,
    userId: null,
    sourceType,
    originalContent: content,
    summaryText: null,
    status: "pending",
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function DashboardShell() {
  const authEnabled = isAuthEnabled();
  const [isMounted, setIsMounted] = useState(false);
  const [history, setHistory] = useState<SummaryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePollingId, setActivePollingId] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const statusBySummaryIdRef = useRef<Record<string, SummaryRecord["status"]>>({});
  const supabase = useMemo(() => {
    if (!authEnabled) {
      return null;
    }

    try {
      return createSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, [authEnabled]);

  const selectedSummary = useMemo(
    () => history.find((item) => item.id === selectedId) ?? null,
    [history, selectedId],
  );

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    ({
      title,
      description,
      tone = "info",
    }: {
      title: string;
      description?: string;
      tone?: ToastTone;
    }) => {
      const id = crypto.randomUUID();

      setToasts((prev) => [...prev, { id, title, description, tone }]);

      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
        toastTimersRef.current.delete(id);
      }, 3200);

      toastTimersRef.current.set(id, timer);
    },
    [],
  );

  const handleSummaryUpdate = useCallback((updatedSummary: SummaryRecord) => {
    const previousStatus = statusBySummaryIdRef.current[updatedSummary.id];
    statusBySummaryIdRef.current[updatedSummary.id] = updatedSummary.status;

    if (previousStatus && previousStatus !== updatedSummary.status) {
      if (updatedSummary.status === "completed") {
        pushToast({
          title: "요약이 완료되었습니다.",
          description: "히스토리에서 최신 결과를 확인해 주세요.",
          tone: "success",
        });
      } else if (updatedSummary.status === "failed") {
        const canceledByUser = extractErrorCode(updatedSummary.errorMessage) === "SUMMARY_CANCELED";
        if (canceledByUser) {
          pushToast({
            title: "요약을 취소했습니다.",
            description: "필요하면 같은 원문으로 다시 요청할 수 있습니다.",
            tone: "info",
          });
        } else {
          pushToast({
            title: "요약 처리에 실패했습니다.",
            description: "원문은 유지되며 재시도할 수 있습니다.",
            tone: "error",
          });
        }
      }
    }

    setHistory((prev) => upsertSummary(prev, updatedSummary));
    setHistoryError(null);
    if (updatedSummary.status === "completed" || updatedSummary.status === "failed") {
      setActivePollingId(null);
    }
  }, [pushToast]);

  const handleSubmitted = useCallback(
    ({ id, sourceType, content }: { id: string; sourceType: SourceType; content: string }) => {
      const pending = buildPendingSummary(id, sourceType, content);
      statusBySummaryIdRef.current[id] = "pending";
      setHistory((prev) => upsertSummary(prev, pending));
      setSelectedId(id);
      setActivePollingId(id);
      setGlobalError(null);
      setPollingError(null);
      setHistoryError(null);
      pushToast({
        title: "요약 요청이 접수되었습니다.",
        description: "처리가 끝나면 자동으로 결과를 갱신합니다.",
        tone: "info",
      });
    },
    [pushToast],
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const timers = toastTimersRef.current;

    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      setIsHistoryLoading(true);
      setHistoryError(null);

      try {
        const items = await getRecentSummaries();
        if (cancelled) {
          return;
        }
        const sorted = sortByLatest(items);
        setHistory(sorted);
        statusBySummaryIdRef.current = Object.fromEntries(
          sorted.map((item) => [item.id, item.status]),
        ) as Record<string, SummaryRecord["status"]>;
        setSelectedId((prev) => {
          if (prev && sorted.some((item) => item.id === prev)) {
            return prev;
          }
          return sorted[0]?.id ?? null;
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "히스토리를 불러오지 못했습니다.";
        setHistoryError(message);
        pushToast({
          title: "히스토리 조회에 실패했습니다.",
          description: message,
          tone: "error",
        });
        if (authEnabled && message.includes("로그인")) {
          window.location.href = "/login";
        }
      } finally {
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [authEnabled, pushToast]);

  const { isPolling } = useSummaryPolling({
    summaryId: activePollingId,
    enabled: Boolean(activePollingId),
    intervalMs: 2000,
    onSummaryUpdate: handleSummaryUpdate,
    onError: setPollingError,
  });

  const handleRetry = useCallback(async () => {
    if (!selectedSummary) {
      return;
    }

    setGlobalError(null);
    try {
      const response = await createSummaryRequest(selectedSummary.sourceType, selectedSummary.originalContent);
      handleSubmitted({
        id: response.id,
        sourceType: selectedSummary.sourceType,
        content: selectedSummary.originalContent,
      });
    } catch (retryError) {
      const message =
        retryError instanceof Error ? retryError.message : "재시도 요청 중 오류가 발생했습니다.";
      setGlobalError(message);
      pushToast({
        title: "재시도 요청에 실패했습니다.",
        description: message,
        tone: "error",
      });
    }
  }, [handleSubmitted, pushToast, selectedSummary]);

  const handleHistorySelect = useCallback((id: string) => {
    setSelectedId(id);
    setMobileSidebarOpen(false);
  }, []);

  const handleCancel = useCallback(async () => {
    if (!selectedSummary || (selectedSummary.status !== "pending" && selectedSummary.status !== "processing")) {
      return;
    }

    setIsCancelling(true);
    setGlobalError(null);

    try {
      const cancelled = await cancelSummaryRequest(selectedSummary.id);
      statusBySummaryIdRef.current[cancelled.id] = cancelled.status;
      setHistory((prev) => upsertSummary(prev, cancelled));
      setSelectedId(cancelled.id);
      setActivePollingId(null);
      setPollingError(null);
      setHistoryError(null);
      pushToast({
        title: "요약을 취소했습니다.",
        description: "필요하면 같은 원문으로 다시 요약할 수 있습니다.",
        tone: "info",
      });
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : "요약 취소에 실패했습니다.";
      setGlobalError(message);
      pushToast({
        title: "요약 취소에 실패했습니다.",
        description: message,
        tone: "error",
      });
    } finally {
      setIsCancelling(false);
    }
  }, [pushToast, selectedSummary]);

  const handleSignOut = useCallback(async () => {
    if (!supabase) {
      setGlobalError("Supabase 설정이 누락되어 로그아웃할 수 없습니다.");
      return;
    }

    setIsSigningOut(true);
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      const message = "로그아웃 요청 중 오류가 발생했지만 로그인 페이지로 이동합니다.";
      setGlobalError(message);
      pushToast({
        title: "로그아웃 중 오류",
        description: message,
        tone: "error",
      });
    } finally {
      window.location.href = "/login";
    }
  }, [pushToast, supabase]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-5">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
              DocuSumm
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              AI 요약 워크스페이스
            </h1>
            <p className="text-sm text-muted-foreground">
              텍스트와 YouTube 콘텐츠를 빠르게 요약하고 히스토리를 관리하세요.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={isPolling ? "secondary" : "outline"}
              className="hidden items-center gap-1.5 px-2.5 py-1 sm:inline-flex"
            >
              <LoaderCircle className={`size-3 ${isPolling ? "animate-spin" : ""}`} />
              {isPolling ? "요약 처리 중" : "대기 상태"}
            </Badge>
            {authEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleSignOut()}
                disabled={isSigningOut}
              >
                {isSigningOut ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
                로그아웃
              </Button>
            ) : null}
            {isMounted ? (
              <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="lg:hidden">
                    <Menu className="size-4" />
                    히스토리
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[320px] gap-0 p-0 sm:max-w-[360px]">
                  <SheetHeader className="border-b border-border/70 px-5 py-4">
                    <SheetTitle>히스토리</SheetTitle>
                  </SheetHeader>
                  <div className="p-4 sm:p-5">
                    <HistoryList
                      items={history}
                      selectedId={selectedId}
                      onSelect={handleHistorySelect}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            ) : (
              <Button type="button" variant="outline" size="sm" className="lg:hidden" disabled>
                <Menu className="size-4" />
                히스토리
              </Button>
            )}
          </div>
        </header>

        <div className="grid flex-1 items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6">
          <aside className="hidden lg:sticky lg:top-6 lg:block">
            <Card className="border-border/80 bg-card/95 shadow-sm">
              <CardHeader className="border-b border-border/70 pb-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="size-4 text-primary" />
                  히스토리
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <HistoryList
                  items={history}
                  selectedId={selectedId}
                  onSelect={handleHistorySelect}
                />
              </CardContent>
            </Card>
          </aside>

          <main className="space-y-5">
            <InputPanel onSubmitted={handleSubmitted} />

            {pollingError || globalError ? (
              <Alert className="border-destructive/40 bg-destructive/5 text-destructive">
                <AlertTitle className="text-sm">요약 요청 오류</AlertTitle>
                <AlertDescription className="text-destructive/90">
                  {pollingError ?? globalError}
                </AlertDescription>
              </Alert>
            ) : null}

            {historyError ? (
              <Alert className="border-destructive/40 bg-destructive/5 text-destructive">
                <AlertTitle className="text-sm">히스토리 조회 오류</AlertTitle>
                <AlertDescription className="text-destructive/90">
                  {historyError}
                </AlertDescription>
              </Alert>
            ) : null}

            {isHistoryLoading ? (
              <LoadingState label="히스토리를 불러오는 중..." />
            ) : selectedSummary ? (
              <SummaryCard
                summary={selectedSummary}
                onRetry={handleRetry}
                onCancel={handleCancel}
                isCancelling={isCancelling}
              />
            ) : (
              <EmptyState />
            )}
          </main>
        </div>
        <ToastStack items={toasts} onDismiss={dismissToast} />
      </div>
    </div>
  );
}
