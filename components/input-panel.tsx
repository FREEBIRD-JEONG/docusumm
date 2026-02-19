"use client";

import { useMemo, useRef, useState } from "react";
import { LoaderCircle, Sparkles, Youtube } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
import { createSummaryRequest } from "@/lib/api/summary-client";
import { cn } from "@/lib/utils";
import { normalizeYouTubeUrl } from "@/lib/validators/youtube";
import type { SourceType } from "@/types/summary";

interface InputPanelProps {
  onSubmitted: (payload: { id: string; sourceType: SourceType; content: string }) => void;
}

export function InputPanel({ onSubmitted }: InputPanelProps) {
  const [sourceType, setSourceType] = useState<SourceType>("text");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useAutoResizeTextarea(textareaRef, content);

  const trimmed = content.trim();
  const normalizedYoutubeUrl = sourceType === "youtube" ? normalizeYouTubeUrl(trimmed) : null;
  const isYoutubeValid = sourceType === "youtube" ? Boolean(normalizedYoutubeUrl) : true;
  const isInputValid = sourceType === "text" ? trimmed.length >= 40 : isYoutubeValid;
  const modeLabel = sourceType === "youtube" ? "YouTube URL" : "텍스트";
  const placeholder =
    sourceType === "youtube"
      ? "요약할 YouTube URL을 붙여넣어 주세요."
      : "요약할 텍스트를 입력해 주세요.";
  const validationMessage = useMemo(() => {
    if (sourceType === "youtube" && trimmed && !isYoutubeValid) {
      return "유효한 YouTube URL을 입력해 주세요.";
    }
    if (sourceType === "text" && trimmed.length > 0 && trimmed.length < 40) {
      return `최소 40자 이상 입력해 주세요. (${trimmed.length}/40)`;
    }
    return null;
  }, [isYoutubeValid, sourceType, trimmed]);
  const helperText = useMemo(() => {
    if (sourceType === "youtube") {
      return "예시: https://youtu.be/VIDEO_ID 또는 youtube.com/watch?v=VIDEO_ID";
    }
    return "최소 40자 이상의 텍스트를 입력해 주세요.";
  }, [sourceType]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isInputValid || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const contentToSend =
        sourceType === "youtube" ? (normalizedYoutubeUrl ?? trimmed) : trimmed;

      const response = await createSummaryRequest(sourceType, contentToSend);
      onSubmitted({ id: response.id, sourceType, content: contentToSend });
      setContent("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "요약 요청에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-border/80 bg-card/95 shadow-sm">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="text-base">입력 패널</CardTitle>
        <CardDescription>
          원문 텍스트 또는 YouTube URL을 입력하면 요약 결과를 생성합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div
          role="radiogroup"
          aria-label="입력 모드 선택"
          className="grid w-full grid-cols-2 rounded-lg border border-border/70 bg-muted/70 p-1"
        >
          <Button
            type="button"
            variant="ghost"
            role="radio"
            aria-checked={sourceType === "text"}
            className={cn(
              "gap-2 rounded-md border border-transparent text-muted-foreground hover:text-foreground",
              sourceType === "text" ? "border-border/70 bg-background text-foreground shadow-sm" : "",
            )}
            onClick={() => {
              setSourceType("text");
              setError(null);
            }}
          >
            <Sparkles className="size-4" />
            텍스트
          </Button>
          <Button
            type="button"
            variant="ghost"
            role="radio"
            aria-checked={sourceType === "youtube"}
            className={cn(
              "gap-2 rounded-md border border-transparent text-muted-foreground hover:text-foreground",
              sourceType === "youtube" ? "border-border/70 bg-background text-foreground shadow-sm" : "",
            )}
            onClick={() => {
              setSourceType("youtube");
              setError(null);
            }}
          >
            <Youtube className="size-4" />
            YouTube
          </Button>
        </div>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={placeholder}
            className="min-h-[140px] resize-none bg-background/70 leading-6"
            aria-invalid={Boolean(validationMessage)}
            aria-label={`${modeLabel} 입력`}
          />

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{helperText}</p>
            {validationMessage ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {validationMessage}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!isInputValid || isSubmitting}
              className="min-w-28 gap-1.5"
            >
              {isSubmitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              요약하기
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
