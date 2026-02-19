import type { SourceType } from "@/types/summary";
import { normalizeYouTubeUrl } from "@/lib/validators/youtube";

export interface CreateSummaryRequestInput {
  sourceType: SourceType;
  content: string;
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function validateSummaryRequest(input: CreateSummaryRequestInput): ValidationResult {
  const content = input.content.trim();
  if (!content) {
    return { ok: false, message: "입력값이 비어 있습니다." };
  }

  if (input.sourceType === "youtube" && !normalizeYouTubeUrl(content)) {
    return {
      ok: false,
      message: "유효한 YouTube URL을 입력해 주세요. (예: https://youtu.be/VIDEO_ID)",
    };
  }

  if (input.sourceType === "text" && content.length < 40) {
    return { ok: false, message: "텍스트는 최소 40자 이상 입력해 주세요." };
  }

  if (content.length > 20000) {
    return { ok: false, message: "입력 길이는 20,000자 이하여야 합니다." };
  }

  return { ok: true };
}

export function parseCreateSummaryPayload(body: unknown): CreateSummaryRequestInput | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const sourceType = (body as { sourceType?: unknown }).sourceType;
  const content = (body as { content?: unknown }).content;

  if ((sourceType !== "text" && sourceType !== "youtube") || typeof content !== "string") {
    return null;
  }

  return { sourceType, content };
}
