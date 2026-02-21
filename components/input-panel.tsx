"use client";

import { useMemo, useRef, useState } from "react";
import { FileText, Link2, LoaderCircle, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
import { ApiClientError, createSummaryRequest } from "@/lib/api/summary-client";
import { cn } from "@/lib/utils";
import { normalizeYouTubeUrl } from "@/lib/validators/youtube";
import type { SourceType } from "@/types/summary";

interface InputPanelProps {
  onSubmitted: (payload: {
    id: string;
    sourceType: SourceType;
    content: string;
    remainingCredits?: number;
  }) => void;
  onInsufficientCredits?: () => void;
}

export function InputPanel({ onSubmitted, onInsufficientCredits }: InputPanelProps) {
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
  const placeholder =
    sourceType === "youtube"
      ? "요약할 YouTube URL을 붙여넣어 주세요."
      : "요약하고 싶은 텍스트를 입력하세요...";
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
  const characterCountLabel = `${content.length} characters`;

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
      onSubmitted({
        id: response.id,
        sourceType,
        content: contentToSend,
        remainingCredits: response.remainingCredits,
      });
      setContent("");
    } catch (submitError) {
      if (submitError instanceof ApiClientError && submitError.code === "INSUFFICIENT_CREDITS") {
        onInsufficientCredits?.();
      }
      setError(submitError instanceof Error ? submitError.message : "요약 요청에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div
        role="radiogroup"
        aria-label="입력 모드 선택"
        className="grid w-full grid-cols-2 rounded-xl border border-[#e5e5e5] bg-[#f1f1f1] p-1"
      >
        <Button
          type="button"
          variant="ghost"
          role="radio"
          aria-checked={sourceType === "text"}
          className={cn(
            "h-10 gap-2 rounded-lg border border-transparent text-[16px] font-medium text-[#5e5e5e] hover:text-[#222222]",
            sourceType === "text" ? "border-[#e2e2e2] bg-white text-[#222222] shadow-none" : "",
          )}
          onClick={() => {
            setSourceType("text");
            setError(null);
          }}
        >
          <FileText className="size-4" />
          Text
        </Button>
        <Button
          type="button"
          variant="ghost"
          role="radio"
          aria-checked={sourceType === "youtube"}
          className={cn(
            "h-10 gap-2 rounded-lg border border-transparent text-[16px] font-medium text-[#5e5e5e] hover:text-[#222222]",
            sourceType === "youtube" ? "border-[#e2e2e2] bg-white text-[#222222] shadow-none" : "",
          )}
          onClick={() => {
            setSourceType("youtube");
            setError(null);
          }}
        >
          <Link2 className="size-4" />
          YouTube
        </Button>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-2xl border border-[#dddddd] bg-white shadow-[0_1px_0_rgba(17,17,17,0.04)]">
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={placeholder}
            className="min-h-[290px] resize-none border-0 bg-transparent px-5 py-4 text-[15px] leading-7 text-[#2b2b2b] shadow-none focus-visible:border-transparent focus-visible:ring-0"
            aria-invalid={Boolean(validationMessage)}
            aria-label={sourceType === "youtube" ? "YouTube URL 입력" : "텍스트 입력"}
          />
          <div className="flex items-center justify-between gap-3 px-5 pb-4 text-sm text-[#a0a0a0]">
            <p className="truncate text-xs text-[#9a9a9a]">{helperText}</p>
            <p className="shrink-0">{characterCountLabel}</p>
          </div>
        </div>

        {validationMessage ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {validationMessage}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={!isInputValid || isSubmitting}
          className={cn(
            "h-14 w-full rounded-xl text-lg font-semibold text-white shadow-none",
            isInputValid
              ? "bg-[#2f6df6] hover:bg-[#215be0] disabled:bg-[#2f6df6] disabled:opacity-70"
              : "bg-[#9f9f9f] hover:bg-[#8f8f8f] disabled:bg-[#c8c8c8]",
          )}
        >
          {isSubmitting ? (
            <>
              <LoaderCircle className="size-5 animate-spin" />
              처리 중...
            </>
          ) : (
            <>
              <Sparkles className="size-5" />
              요약하기
            </>
          )}
        </Button>
      </form>
    </section>
  );
}
