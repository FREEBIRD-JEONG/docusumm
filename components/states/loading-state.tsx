import type { ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface LoadingStateProps {
  label?: string;
  action?: ReactNode;
}

export function LoadingState({ label = "요약 요청 중...", action }: LoadingStateProps) {
  return (
    <Card className="border-border/80 bg-card/95 shadow-sm">
      <CardHeader className="gap-3 border-b border-border/70 pb-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {action}
        </div>
        <div className="h-4 w-36 animate-pulse rounded-md bg-muted" />
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <section className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-4">
          <div className="h-3 w-14 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-11/12 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
        </section>
        <section className="space-y-3">
          <div className="h-3 w-20 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-[92%] animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-[84%] animate-pulse rounded-md bg-muted" />
        </section>
      </CardContent>
    </Card>
  );
}
