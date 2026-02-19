import { Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface EmptyStateProps {
  title?: string;
  description?: string;
}

export function EmptyState({
  title = "첫 번째 요약을 생성해보세요",
  description = "텍스트를 입력하거나 YouTube URL을 붙여넣고 요약하기 버튼을 눌러 시작할 수 있습니다.",
}: EmptyStateProps) {
  return (
    <Card className="border-border/80 bg-card/95 shadow-sm">
      <CardHeader className="gap-3 border-b border-border/70 pb-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="leading-6">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-4 text-xs text-muted-foreground">
        히스토리 패널에서 이전 결과를 다시 확인할 수 있습니다.
      </CardContent>
    </Card>
  );
}
