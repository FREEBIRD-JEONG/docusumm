import { AppError } from "@/lib/errors/app-error";
import { buildSummaryPrompt } from "@/lib/gemini/prompts";
import { generateWithGemini } from "@/lib/gemini/client";
import { buildYouTubePromptContext } from "@/lib/youtube/transcript";
import type { SourceType } from "@/types/summary";

interface SummarizeInput {
  sourceType: SourceType;
  content: string;
  requestId?: string;
}

interface SummarizeResult {
  summaryText: string;
}

function normalizeSummaryText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function stripMarkdownDecorations(text: string): string {
  const stripped = text
    .replace(/^```[\w]*\s*\n?/gm, "")
    .replace(/^```\s*$/gm, "");

  return stripped
    .split("\n")
    .map((line) => {
      let cleaned = line.replace(/^\s*#{1,6}\s+/, "");
      cleaned = cleaned.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1");
      cleaned = cleaned.replace(/^(TL;DR)\s*:\s*$/i, "$1");
      cleaned = cleaned.replace(/^(전체 요약)\s*:\s*$/, "$1");
      cleaned = cleaned.replace(/^(\s*)\*(\s+)/, "$1-$2");
      cleaned = cleaned.replace(/^(\s*)\d+[.)]\s+/, "$1- ");
      return cleaned;
    })
    .join("\n");
}

export function validateSummaryFormat(text: string): boolean {
  const hasTldrSection = /(^|\n)\s*TL;DR\s*($|\n)/i.test(text);
  const hasFullSummarySection = /(^|\n)\s*전체 요약\s*($|\n)/.test(text);
  const bulletCount = (text.match(/^\s*[-•]\s+/gm) ?? []).length;

  return hasTldrSection && hasFullSummarySection && bulletCount >= 3;
}

async function summarizeWithGeminiPrompt({
  sourceType,
  promptInput,
  requestId,
}: {
  sourceType: SourceType;
  promptInput: string;
  requestId?: string;
}): Promise<string> {
  const prompt = buildSummaryPrompt(sourceType, promptInput);
  const raw = await generateWithGemini(prompt, { requestId });
  const normalized = normalizeSummaryText(stripMarkdownDecorations(raw));

  if (!normalized) {
    throw new AppError("Gemini 응답 텍스트가 비어 있습니다.", "GEMINI_OUTPUT_INVALID", 502);
  }

  if (!validateSummaryFormat(normalized)) {
    console.error("[summarize] format validation failed", {
      requestId,
      sourceType,
      normalizedHead: normalized.slice(0, 500),
      hasTldr: /(^|\n)\s*TL;DR\s*($|\n)/i.test(normalized),
      hasFullSummary: /(^|\n)\s*전체 요약\s*($|\n)/.test(normalized),
      bulletCount: (normalized.match(/^\s*[-•]\s+/gm) ?? []).length,
    });
    throw new AppError(
      "Gemini 응답이 TL;DR/전체 요약 형식을 충족하지 않습니다.",
      "GEMINI_OUTPUT_INVALID",
      502,
    );
  }

  return normalized;
}

export async function summarizeWithGemini({
  sourceType,
  content,
  requestId,
}: SummarizeInput): Promise<string> {
  const promptInput =
    sourceType === "youtube" ? (await buildYouTubePromptContext(content)).promptInput : content;
  return summarizeWithGeminiPrompt({ sourceType, promptInput, requestId });
}

export async function summarizeWithFallback(input: SummarizeInput): Promise<SummarizeResult> {
  const summaryText = await summarizeWithGemini(input);
  return { summaryText };
}
