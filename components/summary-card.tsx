import { CalendarClock, Copy, FileText, LoaderCircle, StopCircle } from "lucide-react";

import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { extractErrorCode, toUserFacingErrorMessage } from "@/lib/errors/error-messages";
import { extractFullSummaryText, extractTldr, type SummaryRecord } from "@/types/summary";

interface SummaryCardProps {
  summary: SummaryRecord;
  onRetry?: () => void;
  onCancel?: () => void;
  isCancelling?: boolean;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatUtcDateTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

export function SummaryCard({ summary, onRetry, onCancel, isCancelling = false }: SummaryCardProps) {
  if (summary.status === "pending" || summary.status === "processing") {
    return (
      <LoadingState
        label={summary.status === "processing" ? "요약 생성 중..." : "요약 요청 중..."}
        action={
          onCancel ? (
            <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isCancelling}>
              {isCancelling ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <StopCircle className="size-4" />
              )}
              요약 취소
            </Button>
          ) : null
        }
      />
    );
  }

  const canceledByUser = extractErrorCode(summary.errorMessage) === "SUMMARY_CANCELED";

  if (summary.status === "failed" && canceledByUser) {
    return (
      <Card className="border-border/80 bg-card/95 shadow-sm">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <StopCircle className="size-4 text-muted-foreground" />
            요약 취소됨
          </CardTitle>
          <Badge variant="outline" className="px-2 py-0.5 font-normal text-muted-foreground">
            사용자 취소
          </Badge>
        </CardHeader>
        <CardContent className="pt-5 text-sm text-muted-foreground">
          요청하신 요약 작업이 중단되었습니다. 원문은 유지되며 다시 요약할 수 있습니다.
        </CardContent>
        {onRetry ? (
          <CardFooter className="justify-end border-t border-border/70 pt-4">
            <Button type="button" onClick={onRetry} size="sm">
              다시 요약
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    );
  }

  if (summary.status === "failed") {
    return (
      <ErrorState
        message={toUserFacingErrorMessage(summary.errorMessage, "알 수 없는 오류")}
        onRetry={onRetry}
      />
    );
  }

  const tldr = extractTldr(summary.summaryText);
  const fullSummaryText = extractFullSummaryText(summary.summaryText);
  const createdAtLabel = formatUtcDateTime(summary.createdAt);

  return (
    <Card className="border-border/80 bg-card/95 shadow-sm">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-primary" />
          요약 결과
        </CardTitle>
        <Badge variant="outline" className="flex items-center gap-1 px-2 py-0.5 font-normal">
          <CalendarClock className="size-3" />
          {createdAtLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {tldr.length > 0 ? (
          <section className="rounded-xl border border-primary/25 bg-primary/10 p-4">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-primary/90 uppercase">
              TL;DR
            </p>
            <ul className="mt-3 space-y-2">
              {tldr.map((line) => (
                <li key={line} className="text-sm leading-6 text-foreground">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Separator className="bg-border/70" />

        <section className="space-y-3">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            전체 요약
          </p>
          <div className="whitespace-pre-wrap rounded-xl border border-border/80 bg-muted/35 p-4 text-sm leading-7 text-foreground">
            {fullSummaryText}
          </div>
        </section>
      </CardContent>
      <CardFooter className="justify-end border-t border-border/70 pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            if (!summary.summaryText) {
              return;
            }
            await navigator.clipboard.writeText(summary.summaryText);
          }}
        >
          <Copy className="size-4" />
          복사하기
        </Button>
      </CardFooter>
    </Card>
  );
}
