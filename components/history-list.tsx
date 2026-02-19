import { Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { deriveSummaryTitle, type SummaryRecord } from "@/types/summary";
import { extractErrorCode } from "@/lib/errors/error-messages";
import { cn } from "@/lib/utils";

interface HistoryListProps {
  items: SummaryRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function formatGroupLabel(dateString: string): string {
  const date = new Date(dateString);
  return `${date.getUTCFullYear()}.${(date.getUTCMonth() + 1).toString().padStart(2, "0")}.${date
    .getUTCDate()
    .toString()
    .padStart(2, "0")}`;
}

function formatTimeLabel(dateString: string): string {
  const date = new Date(dateString);
  return `${date.getUTCHours().toString().padStart(2, "0")}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")} UTC`;
}

function buildGroups(items: SummaryRecord[]): Array<{ label: string; items: SummaryRecord[] }> {
  const groups = new Map<string, SummaryRecord[]>();
  for (const item of items) {
    const label = formatGroupLabel(item.createdAt);
    const current = groups.get(label) ?? [];
    current.push(item);
    groups.set(label, current);
  }

  return Array.from(groups.entries()).map(([label, groupedItems]) => ({
    label,
    items: groupedItems,
  }));
}

const STATUS_LABEL: Record<SummaryRecord["status"], string> = {
  pending: "요청됨",
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

export function HistoryList({ items, selectedId, onSelect }: HistoryListProps) {
  if (items.length === 0) {
    return (
      <Card className="border-border/70 py-0">
        <CardContent className="py-8 text-sm text-muted-foreground">
          아직 생성된 요약이 없습니다.
        </CardContent>
      </Card>
    );
  }

  const groups = buildGroups(items);

  return (
    <div className="space-y-4">
      {groups.map((group, groupIndex) => (
        <section key={group.label} className="space-y-2.5">
          {groupIndex > 0 ? <Separator className="bg-border/70" /> : null}
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/95">
            {group.label}
          </p>
          <ul className="space-y-1.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "h-auto w-full justify-start rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selectedId === item.id
                      ? "border-primary/40 bg-primary/10 shadow-sm hover:bg-primary/15"
                      : "border-transparent hover:border-border/80 hover:bg-muted/55",
                  )}
                  aria-current={selectedId === item.id ? "true" : undefined}
                >
                  <div className="flex w-full min-w-0 flex-col items-start gap-2">
                    <p className="w-full min-w-0 truncate text-sm leading-5 font-medium text-foreground">
                      {deriveSummaryTitle(item.originalContent)}
                    </p>
                    <div className="flex w-full items-center justify-between gap-2">
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock3 className="size-3" />
                        {formatTimeLabel(item.createdAt)}
                      </p>
                      <Badge
                        variant={selectedId === item.id ? "secondary" : "outline"}
                        className="shrink-0 text-[10px] tracking-wide"
                      >
                        {getStatusLabel(item)}
                      </Badge>
                    </div>
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
