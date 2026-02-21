"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deriveSummaryTitle, extractTldr, type SummaryRecord } from "@/types/summary";
import { extractErrorCode } from "@/lib/errors/error-messages";
import { cn } from "@/lib/utils";

interface HistoryListProps {
  items: SummaryRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_LABEL: Record<SummaryRecord["status"], string> = {
  pending: "대기",
  processing: "처리중",
  completed: "완료",
  failed: "실패",
};

function getStatusLabel(item: SummaryRecord): string {
  if (item.status === "failed" && extractErrorCode(item.errorMessage) === "SUMMARY_CANCELED") {
    return "취소됨";
  }
  return STATUS_LABEL[item.status];
}

function getStatusDotClass(item: SummaryRecord): string {
  if (item.status === "failed" && extractErrorCode(item.errorMessage) === "SUMMARY_CANCELED") {
    return "bg-[#b2b2b2]";
  }

  switch (item.status) {
    case "pending":
      return "bg-[#8f8f8f]";
    case "processing":
      return "bg-[#5f8ef7]";
    case "completed":
      return "bg-[#22a059]";
    case "failed":
      return "bg-[#db4f4f]";
    default:
      return "bg-[#b2b2b2]";
  }
}

function truncateTitle(value: string, max = 52): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 3).trim()}...`;
}

function stripBulletPrefix(value: string): string {
  return value.replace(/^[-•]\s+/, "").trim();
}

function deriveTextTitle(item: SummaryRecord): string {
  const tldrFirstLine = extractTldr(item.summaryText)[0];
  if (tldrFirstLine) {
    const cleaned = truncateTitle(stripBulletPrefix(tldrFirstLine));
    if (cleaned) {
      return cleaned;
    }
  }

  const firstSentence = item.originalContent
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .find((line) => line.trim().length > 0);

  if (firstSentence) {
    return truncateTitle(firstSentence);
  }

  return "텍스트 요약";
}

function deriveDisplayTitle(item: SummaryRecord, youtubeTitleMap: Record<string, string>): string {
  if (item.sourceType === "youtube") {
    const cachedYoutubeTitle = youtubeTitleMap[item.originalContent];
    if (cachedYoutubeTitle) {
      return truncateTitle(cachedYoutubeTitle, 56);
    }
    return deriveSummaryTitle(item.originalContent);
  }

  return deriveTextTitle(item);
}

function formatDateGroupLabel(dateString: string): string {
  const date = new Date(dateString);
  return `${date.getUTCFullYear()}.${(date.getUTCMonth() + 1).toString().padStart(2, "0")}.${date
    .getUTCDate()
    .toString()
    .padStart(2, "0")}`;
}

function groupByDate(items: SummaryRecord[]): Array<{ label: string; items: SummaryRecord[] }> {
  const groups = new Map<string, SummaryRecord[]>();

  for (const item of items) {
    const label = formatDateGroupLabel(item.createdAt);
    const current = groups.get(label) ?? [];
    current.push(item);
    groups.set(label, current);
  }

  return Array.from(groups.entries()).map(([label, groupedItems]) => ({
    label,
    items: groupedItems,
  }));
}

export function HistoryList({ items, selectedId, onSelect }: HistoryListProps) {
  const [youtubeTitleMap, setYoutubeTitleMap] = useState<Record<string, string>>({});

  const unresolvedYoutubeUrls = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .filter((item) => item.sourceType === "youtube")
            .map((item) => item.originalContent.trim())
            .filter(Boolean),
        ),
      ).filter((url) => !youtubeTitleMap[url]),
    [items, youtubeTitleMap],
  );

  useEffect(() => {
    if (unresolvedYoutubeUrls.length === 0) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const resolveYoutubeTitles = async () => {
      await Promise.all(
        unresolvedYoutubeUrls.map(async (url) => {
          try {
            const response = await fetch(`/api/youtube/title?url=${encodeURIComponent(url)}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) {
              return;
            }

            const data = (await response.json()) as { title?: string };
            const title = data.title?.trim();
            if (!title || cancelled) {
              return;
            }

            setYoutubeTitleMap((prev) => {
              if (prev[url] === title) {
                return prev;
              }
              return { ...prev, [url]: title };
            });
          } catch {
            // Keep the fallback title when YouTube metadata lookup fails.
          }
        }),
      );
    };

    void resolveYoutubeTitles();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [unresolvedYoutubeUrls]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[#e4e4e4] bg-white px-3 py-8 text-center text-sm text-[#9b9b9b]">
        아직 생성된 요약이 없습니다.
      </div>
    );
  }

  const groupedItems = groupByDate(items);

  return (
    <div className="space-y-3">
      {groupedItems.map((group) => (
        <section key={group.label} className="space-y-1.5">
          <p className="px-2 text-[11px] font-semibold tracking-[0.12em] text-[#9a9a9a]">
            {group.label}
          </p>
          <ul className="space-y-1">
            {group.items.map((item) => (
              <li key={item.id}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "h-auto w-full justify-start rounded-lg px-2.5 py-2.5 text-left text-sm font-medium shadow-none",
                    selectedId === item.id
                      ? "bg-[#eceff5] text-[#1f1f1f] hover:bg-[#e8ebf2]"
                      : "text-[#3f3f3f] hover:bg-[#f0f0f0]",
                  )}
                  aria-current={selectedId === item.id ? "true" : undefined}
                  title={getStatusLabel(item)}
                >
                  <div className="flex w-full min-w-0 items-center gap-2.5">
                    {item.sourceType === "youtube" ? (
                      <Link2 className="size-4 shrink-0 text-[#8e8e8e]" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-[#8e8e8e]" />
                    )}
                    <p className="min-w-0 flex-1 truncate leading-5">
                      {deriveDisplayTitle(item, youtubeTitleMap)}
                    </p>
                    <span
                      className={cn("size-2.5 shrink-0 rounded-full", getStatusDotClass(item))}
                      aria-hidden="true"
                    />
                  </div>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
