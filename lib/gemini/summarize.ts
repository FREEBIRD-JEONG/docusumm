import { AppError } from "@/lib/errors/app-error";
import { buildSummaryPrompt } from "@/lib/gemini/prompts";
import { generateWithGemini } from "@/lib/gemini/client";
import { buildYouTubePromptContext, type YouTubePromptContext } from "@/lib/youtube/transcript";
import { normalizeYouTubeUrl } from "@/lib/validators/youtube";
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

function splitSentences(value: string): string[] {
  return value
    .replace(/\r/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function truncateLine(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3).trim()}...`;
}

function isTranscriptNoiseLine(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    normalized.startsWith("kind:") ||
    normalized.startsWith("language:") ||
    normalized.startsWith("webvtt") ||
    normalized.startsWith("note ")
  );
}

function collectTranscriptSentences(transcript: string): string[] {
  return splitSentences(transcript)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => !isTranscriptNoiseLine(line))
    .map((line) => truncateLine(line))
    .filter((line, index, all) => all.indexOf(line) === index);
}

function pickSpreadSentences(lines: string[], count: number): string[] {
  if (count <= 0 || lines.length === 0) {
    return [];
  }

  if (lines.length <= count) {
    return [...lines];
  }

  const picked: string[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const ratio = count === 1 ? 0 : slot / (count - 1);
    const index = Math.min(lines.length - 1, Math.round(ratio * (lines.length - 1)));
    const candidate = lines[index];
    if (!picked.includes(candidate)) {
      picked.push(candidate);
      continue;
    }

    for (let offset = 1; index + offset < lines.length; offset += 1) {
      const next = lines[index + offset];
      if (!picked.includes(next)) {
        picked.push(next);
        break;
      }
    }
  }

  return picked.slice(0, count);
}

function ensureThreeBullets(lines: string[], fallbackPrefix: string): [string, string, string] {
  const picked = [...lines];
  while (picked.length < 3) {
    picked.push(`${fallbackPrefix} ${picked.length + 1}`);
  }
  return [picked[0], picked[1], picked[2]];
}

function buildTextFallback(content: string, reasonCode: string): string {
  const sentences = splitSentences(content)
    .map((line) => truncateLine(line))
    .filter((line, index, all) => all.indexOf(line) === index);

  const firstThree = ensureThreeBullets(
    sentences.slice(0, 3),
    "입력 텍스트 기반 핵심 포인트",
  );
  const bodyLines = sentences.slice(0, 6);
  const body =
    bodyLines.length > 0
      ? bodyLines.join(" ")
      : "입력 텍스트가 짧거나 구조가 단순하여 핵심 내용을 중심으로 간단히 정리했습니다.";

  return [
    "TL;DR",
    `- ${firstThree[0]}`,
    `- ${firstThree[1]}`,
    `- ${firstThree[2]}`,
    "",
    "전체 요약",
    "외부 모델 응답 제한으로 대체 요약을 제공합니다.",
    `원인 코드: ${reasonCode}`,
    body,
  ].join("\n");
}

function buildYoutubeFallback(content: string, reasonCode: string): string {
  const normalized = normalizeYouTubeUrl(content);
  const videoId = normalized ? new URL(normalized).searchParams.get("v") : null;
  const idLabel = videoId ? `영상 ID ${videoId}` : "영상 ID 확인 불가";

  return [
    "TL;DR",
    `- 요청한 YouTube URL(${idLabel})은 처리했지만 현재 모델 응답 제한으로 대체 요약을 제공합니다.`,
    "- URL만으로는 영상의 세부 주장/근거를 정확히 확인할 수 없어 정보가 제한됩니다.",
    "- 자막 또는 핵심 문장을 함께 입력하면 정확도를 크게 높일 수 있습니다.",
    "",
    "전체 요약",
    "외부 모델 응답 제한으로 URL 기반 대체 요약을 제공합니다.",
    `원인 코드: ${reasonCode}`,
    "현재 입력은 YouTube URL 단독이므로 영상 본문의 세부 맥락(논점, 근거, 결론)을 완전하게 재구성할 수 없습니다.",
    "영상 설명/자막/핵심 문장을 추가 입력하면 더 구체적인 TL;DR과 전체 요약을 반환합니다.",
  ].join("\n");
}

function buildYoutubeTranscriptFallback(context: YouTubePromptContext, reasonCode: string): string {
  const sentences = collectTranscriptSentences(context.transcript);
  const firstThree = ensureThreeBullets(
    pickSpreadSentences(sentences, 3),
    "자막 기반 핵심 포인트",
  );
  const bodyLines = pickSpreadSentences(sentences, 5);
  const body =
    bodyLines.length > 0
      ? bodyLines.map((line) => `- ${line}`).join("\n")
      : "영상 자막을 추출했지만 문장 밀도가 낮아 핵심 문장 중심으로 간단히 정리했습니다.";

  return [
    "TL;DR",
    `- ${firstThree[0]}`,
    `- ${firstThree[1]}`,
    `- ${firstThree[2]}`,
    "",
    "전체 요약",
    "외부 모델 응답 제한으로 자막 기반 추출 요약을 제공합니다.",
    `원인 코드: ${reasonCode}`,
    `영상 ID: ${context.videoId}`,
    `영상 제목: ${context.title}`,
    "자막 핵심 문장:",
    body,
  ].join("\n");
}

export function buildFallbackSummary(
  sourceType: SourceType,
  content: string,
  reasonCode = "GEMINI_UNKNOWN_ERROR",
): string {
  const fallback =
    sourceType === "youtube"
      ? buildYoutubeFallback(content, reasonCode)
      : buildTextFallback(content, reasonCode);
  const normalized = normalizeSummaryText(fallback);

  if (!validateSummaryFormat(normalized)) {
    throw new AppError("대체 요약 형식 생성에 실패했습니다.", "FALLBACK_OUTPUT_INVALID", 500);
  }
  return normalized;
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

async function summarizeYouTubeByUrl(
  youtubeUrl: string,
  requestId?: string,
): Promise<string> {
  const prompt = buildSummaryPrompt("youtube", `YouTube URL: ${youtubeUrl}\n이 영상을 시청하고 내용을 요약해 주세요.`);
  const raw = await generateWithGemini(prompt, {
    requestId,
    fileUri: youtubeUrl,
    fileMimeType: "video/*",
  });
  const normalized = normalizeSummaryText(stripMarkdownDecorations(raw));

  if (!normalized) {
    throw new AppError("Gemini URL 기반 응답 텍스트가 비어 있습니다.", "GEMINI_OUTPUT_INVALID", 502);
  }

  if (!validateSummaryFormat(normalized)) {
    throw new AppError(
      "Gemini URL 기반 응답이 TL;DR/전체 요약 형식을 충족하지 않습니다.",
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
  if (input.sourceType === "youtube") {
    let context: YouTubePromptContext;
    try {
      context = await buildYouTubePromptContext(input.content);
    } catch (error) {
      const fallbackReasonCode = error instanceof AppError ? error.code : "YOUTUBE_TRANSCRIPT_FETCH_FAILED";

      // 자막 추출 실패 시 Gemini에 YouTube URL을 직접 전달하여 요약 시도
      const normalized = normalizeYouTubeUrl(input.content);
      if (normalized) {
        try {
          const summaryText = await summarizeYouTubeByUrl(normalized, input.requestId);
          return { summaryText };
        } catch (urlError) {
          console.info("[summarize] YouTube URL-based summarization failed, using generic fallback", {
            requestId: input.requestId,
            reasonCode: fallbackReasonCode,
            urlError: urlError instanceof Error ? urlError.message : "unknown",
          });
        }
      }

      const summaryText = buildFallbackSummary("youtube", input.content, fallbackReasonCode);
      return { summaryText };
    }

    try {
      const summaryText = await summarizeWithGeminiPrompt({
        sourceType: "youtube",
        promptInput: context.promptInput,
        requestId: input.requestId,
      });
      return { summaryText };
    } catch (error) {
      const fallbackReasonCode = error instanceof AppError ? error.code : "GEMINI_UNKNOWN_ERROR";
      if (fallbackReasonCode.startsWith("GEMINI_")) {
        const summaryText = normalizeSummaryText(
          buildYoutubeTranscriptFallback(context, fallbackReasonCode),
        );
        if (!validateSummaryFormat(summaryText)) {
          throw new AppError("자막 기반 대체 요약 형식 생성에 실패했습니다.", "FALLBACK_OUTPUT_INVALID", 500);
        }
        return { summaryText };
      }

      const summaryText = buildFallbackSummary("youtube", input.content, fallbackReasonCode);
      return { summaryText };
    }
  }

  try {
    const summaryText = await summarizeWithGemini(input);
    return { summaryText };
  } catch (error) {
    const fallbackReasonCode = error instanceof AppError ? error.code : "GEMINI_UNKNOWN_ERROR";
    const summaryText = buildFallbackSummary(input.sourceType, input.content, fallbackReasonCode);
    return { summaryText };
  }
}
