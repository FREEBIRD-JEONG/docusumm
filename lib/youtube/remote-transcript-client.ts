import { AppError } from "@/lib/errors/app-error";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_CHARS = 14_000;
const DEFAULT_PREFERRED_LANGUAGES = ["ko", "en", "ja"];
const REMOTE_ENDPOINT_PATH = "/v1/youtube-transcript";
const KNOWN_REMOTE_CODES = new Set([
  "YOUTUBE_URL_INVALID",
  "YOUTUBE_TRANSCRIPT_UNAVAILABLE",
  "YOUTUBE_TRANSCRIPT_BLOCKED",
  "YOUTUBE_TRANSCRIPT_FETCH_FAILED",
  "TRANSCRIPT_WORKER_TIMEOUT",
  "TRANSCRIPT_WORKER_UNAVAILABLE",
]);

export interface FetchRemoteYouTubeTranscriptInput {
  youtubeUrl: string;
  requestId?: string;
  preferredLanguages?: string[];
  maxChars?: number;
}

export interface RemoteYouTubeTranscriptResult {
  transcript: string;
  videoId: string;
  title: string;
  languageCode: string;
  provider: string;
  durationMs: number;
}

interface RemoteErrorResponse {
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
}

interface RemoteSuccessResponse {
  transcript?: unknown;
  videoId?: unknown;
  title?: unknown;
  languageCode?: unknown;
  provider?: unknown;
  durationMs?: unknown;
}

function parsePositiveInteger(rawValue: string | undefined, defaultValue: number): number {
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return defaultValue;
  }

  return normalized;
}

function resolveTimeoutMs(): number {
  return parsePositiveInteger(process.env.TRANSCRIPT_WORKER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

function resolveWorkerUrl(): string {
  const workerUrl = process.env.TRANSCRIPT_WORKER_URL?.trim();
  if (!workerUrl) {
    throw new AppError(
      "외부 transcript worker URL이 설정되지 않았습니다. TRANSCRIPT_WORKER_URL을 확인해 주세요.",
      "TRANSCRIPT_WORKER_UNAVAILABLE",
      503,
    );
  }

  return workerUrl.replace(/\/+$/, "");
}

function resolveWorkerKey(): string {
  const workerKey = process.env.TRANSCRIPT_WORKER_KEY?.trim();
  if (!workerKey) {
    throw new AppError(
      "외부 transcript worker 인증 키가 설정되지 않았습니다. TRANSCRIPT_WORKER_KEY를 확인해 주세요.",
      "TRANSCRIPT_WORKER_UNAVAILABLE",
      503,
    );
  }

  return workerKey;
}

function normalizePreferredLanguages(languages: string[] | undefined): string[] {
  const source = languages && languages.length > 0 ? languages : DEFAULT_PREFERRED_LANGUAGES;
  const normalized = source
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index);

  return normalized.length > 0 ? normalized : [...DEFAULT_PREFERRED_LANGUAGES];
}

function normalizeMaxChars(maxChars: number | undefined): number {
  if (typeof maxChars !== "number" || !Number.isFinite(maxChars)) {
    return DEFAULT_MAX_CHARS;
  }

  const normalized = Math.floor(maxChars);
  if (normalized < 1_000) {
    return 1_000;
  }
  if (normalized > 50_000) {
    return 50_000;
  }
  return normalized;
}

async function safeParseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toStatusCode(code: string, fallbackStatus: number): number {
  switch (code) {
    case "YOUTUBE_URL_INVALID":
    case "YOUTUBE_TRANSCRIPT_UNAVAILABLE":
      return 422;
    case "TRANSCRIPT_WORKER_TIMEOUT":
      return 504;
    case "YOUTUBE_TRANSCRIPT_BLOCKED":
    case "YOUTUBE_TRANSCRIPT_FETCH_FAILED":
    case "TRANSCRIPT_WORKER_UNAVAILABLE":
      return 502;
    default:
      return fallbackStatus >= 400 ? fallbackStatus : 502;
  }
}

function toRemoteFailureError(
  payload: unknown,
  responseStatus: number,
  endpoint: string,
): AppError {
  const failure = (payload ?? {}) as RemoteErrorResponse;
  const code = typeof failure.code === "string" ? failure.code.trim() : "";
  const message =
    typeof failure.message === "string" && failure.message.trim().length > 0
      ? failure.message.trim()
      : `외부 transcript worker 호출 실패 (${responseStatus})`;
  const retryable = failure.retryable === true;

  if (code && KNOWN_REMOTE_CODES.has(code)) {
    return new AppError(message, code, toStatusCode(code, responseStatus));
  }

  if (retryable || responseStatus >= 500 || responseStatus === 429) {
    return new AppError(
      `${message} (endpoint: ${endpoint})`,
      "TRANSCRIPT_WORKER_UNAVAILABLE",
      503,
    );
  }

  return new AppError(
    `${message} (endpoint: ${endpoint})`,
    "TRANSCRIPT_WORKER_UNAVAILABLE",
    502,
  );
}

function toRemoteSuccess(payload: unknown): RemoteYouTubeTranscriptResult {
  const data = (payload ?? {}) as RemoteSuccessResponse;
  const transcript = typeof data.transcript === "string" ? data.transcript.trim() : "";
  const videoId = typeof data.videoId === "string" ? data.videoId.trim() : "";
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const languageCode = typeof data.languageCode === "string" ? data.languageCode.trim() : "";
  const provider = typeof data.provider === "string" ? data.provider.trim() : "";
  const durationMs = typeof data.durationMs === "number" ? data.durationMs : NaN;

  if (!transcript || !videoId || !languageCode || !provider) {
    throw new AppError(
      "외부 transcript worker 응답 형식이 올바르지 않습니다.",
      "TRANSCRIPT_WORKER_UNAVAILABLE",
      502,
    );
  }

  return {
    transcript,
    videoId,
    title: title || "(확인 불가)",
    languageCode,
    provider,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0,
  };
}

export async function fetchRemoteYouTubeTranscript(
  input: FetchRemoteYouTubeTranscriptInput,
): Promise<RemoteYouTubeTranscriptResult> {
  const endpoint = `${resolveWorkerUrl()}${REMOTE_ENDPOINT_PATH}`;
  const workerKey = resolveWorkerKey();
  const requestId = input.requestId ?? crypto.randomUUID();
  const timeoutMs = resolveTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    youtubeUrl: input.youtubeUrl,
    requestId,
    preferredLanguages: normalizePreferredLanguages(input.preferredLanguages),
    maxChars: normalizeMaxChars(input.maxChars),
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-transcript-worker-key": workerKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = await safeParseJson(response);
      throw toRemoteFailureError(payload, response.status, endpoint);
    }

    const payload = await safeParseJson(response);
    return toRemoteSuccess(payload);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(
        `외부 transcript worker 응답 시간이 ${timeoutMs}ms를 초과했습니다.`,
        "TRANSCRIPT_WORKER_TIMEOUT",
        504,
      );
    }

    const message = error instanceof Error ? error.message : "unknown";
    throw new AppError(
      `외부 transcript worker 요청 실패: ${message}`,
      "TRANSCRIPT_WORKER_UNAVAILABLE",
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}

