import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <Alert className="border-destructive/40 bg-destructive/5 text-destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle className="text-sm">요약 처리에 실패했습니다.</AlertTitle>
      <AlertDescription className="whitespace-pre-wrap text-destructive/90">
        {message}
      </AlertDescription>
      {onRetry ? (
        <Button
          type="button"
          onClick={onRetry}
          variant="outline"
          size="sm"
          className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          다시 시도
        </Button>
      ) : null}
    </Alert>
  );
}
