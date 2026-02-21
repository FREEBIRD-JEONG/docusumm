"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CreditCard, FilePlus2, LoaderCircle, LogOut, Menu } from "lucide-react";

import { HistoryList } from "@/components/history-list";
import { InputPanel } from "@/components/input-panel";
import { CreditTopupDialog } from "@/components/payment/credit-topup-dialog";
import { EmptyState } from "@/components/states/empty-state";
import { LoadingState } from "@/components/states/loading-state";
import { SummaryCard } from "@/components/summary-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToastStack, type ToastMessage, type ToastTone } from "@/components/ui/toast-stack";
import { useSummaryPolling } from "@/hooks/use-summary-polling";
import { extractErrorCode } from "@/lib/errors/error-messages";
import { isAuthEnabled } from "@/lib/auth/runtime";
import {
  ApiClientError,
  cancelSummaryRequest,
  confirmCheckoutSessionRequest,
  getAccountProfileRequest,
  createSummaryRequest,
  deleteAllSummariesRequest,
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

function isInsufficientCreditError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "INSUFFICIENT_CREDITS";
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
  const [isDeletingAllHistory, setIsDeletingAllHistory] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isTopupDialogOpen, setIsTopupDialogOpen] = useState(false);
  const [inputPanelResetKey, setInputPanelResetKey] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountCredits, setAccountCredits] = useState<number | null>(null);
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
  const accountLabel = authEnabled
    ? accountEmail ?? "계정 정보를 불러오는 중..."
    : "Guest mode";
  const accountCreditsLabel =
    accountCredits === null ? "확인 중..." : `${accountCredits.toLocaleString()}개`;
  const accountInitial = accountLabel.trim().charAt(0).toUpperCase() || "G";
  const isSummaryFocusMode = Boolean(selectedSummary && selectedSummary.status === "completed");

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
    ({
      id,
      sourceType,
      content,
      remainingCredits,
    }: {
      id: string;
      sourceType: SourceType;
      content: string;
      remainingCredits?: number;
    }) => {
      const pending = buildPendingSummary(id, sourceType, content);
      statusBySummaryIdRef.current[id] = "pending";
      setHistory((prev) => upsertSummary(prev, pending));
      setSelectedId(id);
      setActivePollingId(id);
      setGlobalError(null);
      setPollingError(null);
      setHistoryError(null);
      if (typeof remainingCredits === "number") {
        setAccountCredits(remainingCredits);
      }
      pushToast({
        title: "요약 요청이 접수되었습니다.",
        description: "처리가 끝나면 자동으로 결과를 갱신합니다.",
        tone: "info",
      });
    },
    [pushToast],
  );

  const refreshAccount = useCallback(async () => {
    if (!authEnabled) {
      setAccountEmail("guest@local.invalid");
      setAccountCredits(3);
      return;
    }

    try {
      const account = await getAccountProfileRequest();
      setAccountEmail(account.email || "로그인 사용자");
      setAccountCredits(account.credits);
    } catch (error) {
      const message = error instanceof Error ? error.message : "계정 정보를 불러오지 못했습니다.";
      setAccountEmail("로그인 사용자");
      setAccountCredits(null);
      if (message.includes("로그인")) {
        window.location.href = "/login";
      }
    }
  }, [authEnabled]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      await refreshAccount();
      if (cancelled) {
        return;
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshAccount]);

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
        const urlSummaryId = new URL(window.location.href).searchParams.get("summaryId");
        const hasUrlSummaryId = Boolean(urlSummaryId && sorted.some((item) => item.id === urlSummaryId));
        setHistory(sorted);
        statusBySummaryIdRef.current = Object.fromEntries(
          sorted.map((item) => [item.id, item.status]),
        ) as Record<string, SummaryRecord["status"]>;
        setSelectedId((prev) => {
          if (hasUrlSummaryId) {
            return urlSummaryId;
          }
          if (prev && sorted.some((item) => item.id === prev)) {
            return prev;
          }
          return null;
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
        remainingCredits: response.remainingCredits,
      });
    } catch (retryError) {
      if (isInsufficientCreditError(retryError)) {
        setIsTopupDialogOpen(true);
      }
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

  const handleNewSummary = useCallback(() => {
    setSelectedId(null);
    setGlobalError(null);
    setPollingError(null);
    setMobileSidebarOpen(false);
    setInputPanelResetKey((prev) => prev + 1);
  }, []);

  const handleBackToDashboard = useCallback(() => {
    handleNewSummary();
    const url = new URL(window.location.href);
    if (!url.searchParams.has("summaryId")) {
      return;
    }
    url.searchParams.delete("summaryId");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [handleNewSummary]);

  const openTopupDialog = useCallback(() => {
    setIsTopupDialogOpen(true);
  }, []);

  const openDeleteConfirmModal = useCallback(() => {
    if (isDeletingAllHistory || history.length === 0) {
      return;
    }
    setIsDeleteConfirmOpen(true);
  }, [history.length, isDeletingAllHistory]);

  const closeDeleteConfirmModal = useCallback(() => {
    if (isDeletingAllHistory) {
      return;
    }
    setIsDeleteConfirmOpen(false);
  }, [isDeletingAllHistory]);

  const handleDeleteAllHistory = useCallback(async () => {
    if (isDeletingAllHistory || history.length === 0) {
      return;
    }

    setIsDeletingAllHistory(true);
    setIsDeleteConfirmOpen(false);
    setGlobalError(null);

    try {
      const deletedCount = await deleteAllSummariesRequest();
      statusBySummaryIdRef.current = {};
      setHistory([]);
      setSelectedId(null);
      setActivePollingId(null);
      setPollingError(null);
      setHistoryError(null);
      setMobileSidebarOpen(false);
      pushToast({
        title: "히스토리를 삭제했습니다.",
        description:
          deletedCount > 0
            ? `${deletedCount}개의 항목을 삭제했습니다.`
            : "삭제할 항목이 없었습니다.",
        tone: "success",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "히스토리 전체 삭제 중 오류가 발생했습니다.";
      setGlobalError(message);
      pushToast({
        title: "히스토리 삭제에 실패했습니다.",
        description: message,
        tone: "error",
      });
    } finally {
      setIsDeletingAllHistory(false);
    }
  }, [history.length, isDeletingAllHistory, pushToast]);

  useEffect(() => {
    if (!isDeleteConfirmOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDeleteConfirmModal();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeDeleteConfirmModal, isDeleteConfirmOpen]);

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

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    const url = new URL(window.location.href);
    const paymentState = url.searchParams.get("payment");
    if (!paymentState) {
      return;
    }

    if (paymentState === "success") {
      const sessionId = url.searchParams.get("session_id");
      const syncPaymentResult = async () => {
        try {
          if (sessionId) {
            const result = await confirmCheckoutSessionRequest(sessionId);
            if (!result.handled || result.paid === false) {
              pushToast({
                title: "결제를 확인하는 중입니다.",
                description: "결제 반영이 완료되면 크레딧 잔액이 자동으로 갱신됩니다.",
                tone: "info",
              });
              return;
            }
            if (typeof result.newCredits === "number") {
              setAccountCredits(result.newCredits);
            }
            pushToast({
              title: "충전이 완료되었습니다.",
              description: result.duplicate
                ? "이미 반영된 충전 내역을 확인했습니다."
                : "최신 크레딧 잔액을 반영했습니다.",
              tone: "success",
            });
          } else {
            pushToast({
              title: "충전이 완료되었습니다.",
              description: "결제 세션 정보가 없어 잔액만 새로고침합니다.",
              tone: "info",
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "결제 확인 중 오류가 발생했습니다.";
          pushToast({
            title: "결제는 완료되었습니다.",
            description: `${message} 크레딧 반영이 지연되면 잠시 후 새로고침해 주세요.`,
            tone: "info",
          });
        } finally {
          await refreshAccount();
        }
      };
      void syncPaymentResult();
    } else if (paymentState === "canceled") {
      pushToast({
        title: "결제가 취소되었습니다.",
        description: "원할 때 다시 충전을 진행할 수 있습니다.",
        tone: "info",
      });
    }

    url.searchParams.delete("payment");
    url.searchParams.delete("session_id");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [isMounted, pushToast, refreshAccount]);

  return (
    <div className="h-screen overflow-hidden bg-[#f4f4f5]">
      <div className="flex h-full">
        <aside className="hidden h-full w-[280px] shrink-0 border-r border-[#e4e4e4] bg-[#f8f8f8] lg:flex lg:flex-col">
          <div className="border-b border-[#e4e4e4] px-4 py-5">
            <button
              type="button"
              onClick={handleNewSummary}
              className="-ml-1 mb-4 flex items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-[#efefef]"
              aria-label="초기 대시보드로 이동"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#1f1f1f] text-lg font-semibold text-white">
                D
              </div>
              <p className="text-3xl font-semibold text-[#202020]">DocuSumm</p>
            </button>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full justify-start gap-2 border-[#dbdbdb] bg-white text-base font-medium text-[#2f2f2f] shadow-none hover:bg-[#f2f2f2]"
              onClick={handleNewSummary}
            >
              <FilePlus2 className="size-4" />
              New Summary
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-none px-3 py-5">
            <div className="flex items-center justify-between px-2">
              <p className="text-sm font-medium text-[#8d8d8d]">History</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={openDeleteConfirmModal}
                disabled={isDeletingAllHistory || history.length === 0}
                className="h-7 px-2 text-xs text-[#8d8d8d] hover:bg-[#eeeeee] hover:text-[#4f4f4f]"
              >
                {isDeletingAllHistory ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : null}
                전체삭제
              </Button>
            </div>
            <div className="mt-3">
              {isHistoryLoading ? (
                <p className="rounded-lg border border-[#e3e3e3] bg-white px-3 py-8 text-center text-sm text-[#9a9a9a]">
                  히스토리를 불러오는 중...
                </p>
              ) : (
                <HistoryList
                  items={history}
                  selectedId={selectedId}
                  onSelect={handleHistorySelect}
                />
              )}
            </div>
          </div>

          <div className="border-t border-[#e4e4e4] px-4 py-4">
            <div className="flex items-center gap-3 rounded-lg px-2 py-2 text-base text-[#3e3e3e]">
              <span className="flex size-9 items-center justify-center rounded-full bg-[#2a2a2a] text-white">
                {accountInitial}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#2f2f2f]">My Account</p>
                <p className="truncate text-xs text-[#828282]">{accountLabel}</p>
                <p className="text-xs font-medium text-[#5c5c5c]">크레딧: {accountCreditsLabel}</p>
              </div>
            </div>
            <div className="mt-1 flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                onClick={openTopupDialog}
                className="h-9 justify-start gap-2 rounded-lg px-2 text-sm font-medium text-[#505050] hover:bg-[#efefef] hover:text-[#222222]"
              >
                <CreditCard className="size-4" />
                충전하기
              </Button>
              {authEnabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleSignOut()}
                  disabled={isSigningOut}
                  className="h-9 justify-start gap-2 rounded-lg px-2 text-sm font-medium text-[#505050] hover:bg-[#efefef] hover:text-[#222222]"
                >
                  {isSigningOut ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <LogOut className="size-4" />
                  )}
                  로그아웃
                </Button>
              ) : null}
            </div>
          </div>
          </aside>

        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-[#e4e4e4] bg-[#f8f8f8] px-4 py-3 lg:hidden">
            <button
              type="button"
              onClick={handleNewSummary}
              className="-ml-1 flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[#efefef]"
              aria-label="초기 대시보드로 이동"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#1f1f1f] text-sm font-semibold text-white">
                D
              </div>
              <p className="text-lg font-semibold text-[#202020]">DocuSumm</p>
            </button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1 border-[#dbdbdb] bg-white shadow-none"
                onClick={handleNewSummary}
              >
                <FilePlus2 className="size-4" />
                New
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1 border-[#dbdbdb] bg-white shadow-none"
                onClick={openTopupDialog}
              >
                <CreditCard className="size-4" />
                Charge
              </Button>
              {isMounted ? (
                <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="border-[#dbdbdb] bg-white shadow-none">
                      <Menu className="size-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[320px] gap-0 border-r border-[#e4e4e4] bg-[#f8f8f8] p-0 sm:max-w-[360px]">
                    <SheetHeader className="border-b border-[#e4e4e4] px-5 py-4">
                      <SheetTitle>History</SheetTitle>
                    </SheetHeader>
                    <div className="p-4 sm:p-5">
                      <div className="mb-3 flex items-center justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={openDeleteConfirmModal}
                          disabled={isDeletingAllHistory || history.length === 0}
                          className="h-7 px-2 text-xs text-[#8d8d8d] hover:bg-[#eeeeee] hover:text-[#4f4f4f]"
                        >
                          {isDeletingAllHistory ? (
                            <LoaderCircle className="size-3 animate-spin" />
                          ) : null}
                          전체삭제
                        </Button>
                      </div>
                      {isHistoryLoading ? (
                        <p className="rounded-lg border border-[#e3e3e3] bg-white px-3 py-8 text-center text-sm text-[#9a9a9a]">
                          히스토리를 불러오는 중...
                        </p>
                      ) : (
                        <HistoryList
                          items={history}
                          selectedId={selectedId}
                          onSelect={handleHistorySelect}
                        />
                      )}
                    </div>
                  </SheetContent>
                </Sheet>
              ) : (
                <Button type="button" variant="outline" size="sm" className="border-[#dbdbdb] bg-white shadow-none" disabled>
                  <Menu className="size-4" />
                </Button>
              )}
            </div>
          </header>

          <main className={`flex-1 overflow-y-auto overscroll-none px-4 sm:px-8 lg:px-12 ${isSummaryFocusMode ? "py-6" : "py-8"}`}>
            <div className={`mx-auto w-full max-w-4xl ${isSummaryFocusMode ? "space-y-4" : "space-y-6"}`}>
              {isSummaryFocusMode ? (
                <>
                  <div className="flex">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 gap-2 rounded-lg px-2 text-sm font-medium text-[#404040] hover:bg-[#efefef] hover:text-[#1f1f1f]"
                      onClick={handleBackToDashboard}
                    >
                      <ArrowLeft className="size-4" />
                      대시보드로
                    </Button>
                  </div>
                  {selectedSummary ? (
                    <SummaryCard
                      summary={selectedSummary}
                      onRetry={handleRetry}
                      onCancel={handleCancel}
                      isCancelling={isCancelling}
                    />
                  ) : (
                    <EmptyState />
                  )}
                </>
              ) : (
                <>
                  <section className="space-y-2 text-center">
                    <h1 className="text-4xl font-bold tracking-tight text-[#111111] sm:text-5xl">
                      AI로 모든 것을 요약하세요
                    </h1>
                    <p className="text-lg text-[#8a8a8a]">
                      긴 문서도, YouTube 영상도 단 몇 초 만에 핵심만 파악할 수 있습니다.
                    </p>
                    <p className="flex items-center justify-center gap-2 text-sm text-[#8e8e8e]">
                      <LoaderCircle className={`size-4 ${isPolling ? "animate-spin text-[#5f8ef7]" : "hidden"}`} />
                      {isPolling ? "요약 처리 중..." : "요약 대기 중"}
                    </p>
                  </section>

                  <InputPanel
                    key={inputPanelResetKey}
                    onSubmitted={handleSubmitted}
                    onInsufficientCredits={openTopupDialog}
                  />

                  {pollingError || globalError ? (
                    <Alert className="border-destructive/35 bg-destructive/5 text-destructive">
                      <AlertTitle className="text-sm">요약 요청 오류</AlertTitle>
                      <AlertDescription className="text-destructive/90">
                        {pollingError ?? globalError}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {historyError ? (
                    <Alert className="border-destructive/35 bg-destructive/5 text-destructive">
                      <AlertTitle className="text-sm">히스토리 조회 오류</AlertTitle>
                      <AlertDescription className="text-destructive/90">
                        {historyError}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {isHistoryLoading ? (
                    <LoadingState label="요약 이력을 불러오는 중..." />
                  ) : selectedSummary ? (
                    <SummaryCard
                      summary={selectedSummary}
                      onRetry={handleRetry}
                      onCancel={handleCancel}
                      isCancelling={isCancelling}
                    />
                  ) : history.length === 0 ? (
                    <EmptyState />
                  ) : null}
                </>
              )}
            </div>
          </main>
        </div>

        {isDeleteConfirmOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-history-modal-title"
            onClick={closeDeleteConfirmModal}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-[#d8d8d8] bg-white p-5 shadow-[0_20px_60px_rgba(15,15,15,0.2)]"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="delete-history-modal-title" className="text-lg font-semibold text-[#1d1d1d]">
                히스토리 전체 삭제
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#666666]">
                저장된 히스토리를 모두 삭제할까요? 삭제 후에는 복구할 수 없습니다.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDeleteConfirmModal}
                  disabled={isDeletingAllHistory}
                  className="border-[#d8d8d8] bg-white text-[#4d4d4d] shadow-none hover:bg-[#f5f5f5]"
                >
                  아니오
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleDeleteAllHistory()}
                  disabled={isDeletingAllHistory}
                  className="min-w-24"
                >
                  {isDeletingAllHistory ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      삭제 중
                    </>
                  ) : (
                    "예, 삭제"
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <CreditTopupDialog
          open={isTopupDialogOpen}
          onOpenChange={setIsTopupDialogOpen}
          onCheckoutCreated={() => {
            pushToast({
              title: "결제 페이지로 이동합니다.",
              description: "Stripe Checkout에서 결제를 완료해 주세요.",
              tone: "info",
            });
          }}
          onError={(message, code) => {
            if (code === "INSUFFICIENT_CREDITS") {
              setIsTopupDialogOpen(true);
            }
            setGlobalError(message);
            pushToast({
              title: "결제 시작에 실패했습니다.",
              description: message,
              tone: "error",
            });
          }}
        />

        <ToastStack items={toasts} onDismiss={dismissToast} />
      </div>
    </div>
  );
}
