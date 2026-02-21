import { GoogleGenAI } from "@google/genai";

import { AppError } from "@/lib/errors/app-error";
import { getGeminiRuntimeConfig } from "@/lib/gemini/config";

interface GenerateWithGeminiOptions {
  requestId?: string;
  fileUri?: string;
  fileMimeType?: string;
}

interface GeminiLogPayload {
  requestId: string;
  model: string;
  modelIndex?: number;
  candidateCount?: number;
  apiVersion: string;
  attempt?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  durationMs?: number;
  status?: number;
  errorCode?: string;
  errorName?: string;
  errorMessageHead?: string;
}

interface GeminiClientCache {
  apiKey: string;
  apiVersion: string;
  client: GoogleGenAI;
}

let cachedClient: GeminiClientCache | null = null;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function getGeminiClient(apiKey: string, apiVersion: string): GoogleGenAI {
  if (
    cachedClient &&
    cachedClient.apiKey === apiKey &&
    cachedClient.apiVersion === apiVersion
  ) {
    return cachedClient.client;
  }

  const client = new GoogleGenAI({
    apiKey,
    apiVersion,
  });
  cachedClient = {
    apiKey,
    apiVersion,
    client,
  };

  return client;
}

function resolveStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }

  return undefined;
}

function resolveErrorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return "UnknownError";
}

function summarizeErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message.replace(/\s+/g, " ").trim().slice(0, 240);
  }
  if (typeof error === "string") {
    return error.replace(/\s+/g, " ").trim().slice(0, 240);
  }
  return "unknown error";
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError") {
    return true;
  }

  return /timeout|timed out|deadline/i.test(error.message);
}

function isRetryableRequestError(error: unknown, status: number | undefined): boolean {
  if (typeof status === "number" && RETRYABLE_HTTP_STATUSES.has(status)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /rate limit|too many requests|resource exhausted|overloaded|temporar(?:y|ily) unavailable/i.test(
    error.message,
  );
}

function isModelSelectionError(error: unknown, status: number | undefined): boolean {
  if (status === 404) {
    return true;
  }

  if (status !== 400 || !(error instanceof Error)) {
    return false;
  }

  const lowered = error.message.toLowerCase();
  return (
    lowered.includes("not found for api version") ||
    lowered.includes("not supported for generatecontent") ||
    lowered.includes("model") && lowered.includes("not found")
  );
}

function backoffDelayMs(baseDelayMs: number, attempt: number): number {
  const delay = baseDelayMs * 2 ** attempt;
  return Math.min(delay, 12_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logGemini(
  logLevel: "info" | "debug",
  level: "info" | "debug" | "error",
  message: string,
  payload: GeminiLogPayload,
) {
  if (level === "debug" && logLevel !== "debug") {
    return;
  }

  const logger =
    level === "error" ? console.error : level === "debug" ? console.debug : console.info;
  logger(`[gemini] ${message}`, payload);
}

export async function generateWithGemini(
  prompt: string,
  options: GenerateWithGeminiOptions = {},
): Promise<string> {
  const config = getGeminiRuntimeConfig();
  const modelCandidates =
    config.modelCandidates.length > 0 ? config.modelCandidates : [config.model];
  const requestId = options.requestId ?? crypto.randomUUID();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new AppError(
      "GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인해 주세요.",
      "MISSING_GEMINI_KEY",
      500,
    );
  }

  const ai = getGeminiClient(apiKey, config.apiVersion);

  for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
    const model = modelCandidates[modelIndex];
    const isThinkingModel = /gemini-2\.5/i.test(model);
    const effectiveMaxOutputTokens = isThinkingModel
      ? Math.max(config.maxOutputTokens, 8192)
      : config.maxOutputTokens;
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const startedAt = Date.now();

      logGemini(config.logLevel, "debug", "request started", {
        requestId,
        model,
        modelIndex: modelIndex + 1,
        candidateCount: modelCandidates.length,
        apiVersion: config.apiVersion,
        attempt: attempt + 1,
        maxRetries: config.maxRetries,
      });

      try {
        const contents = options.fileUri
          ? [
              {
                role: "user" as const,
                parts: [
                  {
                    fileData: {
                      fileUri: options.fileUri,
                      mimeType: options.fileMimeType ?? "video/*",
                    },
                  },
                  { text: prompt },
                ],
              },
            ]
          : prompt;

        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            abortSignal: controller.signal,
            httpOptions: {
              timeout: config.timeoutMs,
            },
            maxOutputTokens: effectiveMaxOutputTokens,
            temperature: config.temperature,
            topP: config.topP,
          },
        });

        const durationMs = Date.now() - startedAt;
        const text = response.text?.trim() ?? "";

        if (!text) {
          logGemini(config.logLevel, "error", "empty response", {
            requestId,
            model,
            modelIndex: modelIndex + 1,
            candidateCount: modelCandidates.length,
            apiVersion: config.apiVersion,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            durationMs,
            errorCode: "GEMINI_EMPTY_RESPONSE",
          });
          throw new AppError("Gemini 응답에 요약 텍스트가 없습니다.", "GEMINI_EMPTY_RESPONSE", 502);
        }

        logGemini(config.logLevel, "info", "request completed", {
          requestId,
          model,
          modelIndex: modelIndex + 1,
          candidateCount: modelCandidates.length,
          apiVersion: config.apiVersion,
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
          durationMs,
          status: response.sdkHttpResponse?.responseInternal?.status,
        });

        return text;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const status = resolveStatus(error);
        const timeoutError = isTimeoutError(error);
        const modelSelectionError = isModelSelectionError(error, status);
        const errorName = resolveErrorName(error);
        const errorMessageHead = summarizeErrorMessage(error);
        const retryableError = timeoutError || isRetryableRequestError(error, status);
        const canRetry = attempt < config.maxRetries && retryableError;

        if (canRetry) {
          const retryDelayMs = backoffDelayMs(config.retryBaseDelayMs, attempt);
          logGemini(config.logLevel, "info", "request retry scheduled", {
            requestId,
            model,
            modelIndex: modelIndex + 1,
            candidateCount: modelCandidates.length,
            apiVersion: config.apiVersion,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            durationMs,
            status,
            retryDelayMs,
            errorCode: timeoutError ? "GEMINI_TIMEOUT" : "GEMINI_REQUEST_FAILED",
            errorName,
            errorMessageHead,
          });
          attempt += 1;
          await sleep(retryDelayMs);
          continue;
        }

        const hasNextCandidate = modelIndex < modelCandidates.length - 1;
        if (modelSelectionError && hasNextCandidate) {
          logGemini(config.logLevel, "info", "switching model candidate (unavailable)", {
            requestId,
            model,
            modelIndex: modelIndex + 1,
            candidateCount: modelCandidates.length,
            apiVersion: config.apiVersion,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            durationMs,
            status,
            errorCode: "GEMINI_CONFIG_INVALID",
            errorName,
            errorMessageHead,
          });
          break;
        }

        if (modelSelectionError) {
          logGemini(config.logLevel, "error", "model unavailable", {
            requestId,
            model,
            modelIndex: modelIndex + 1,
            candidateCount: modelCandidates.length,
            apiVersion: config.apiVersion,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            durationMs,
            status,
            errorCode: "GEMINI_CONFIG_INVALID",
            errorName,
            errorMessageHead,
          });
          throw new AppError(
            `요청한 Gemini 모델을 사용할 수 없습니다: ${model}. GEMINI_MODEL/GEMINI_MODEL_CANDIDATES를 확인해 주세요.`,
            "GEMINI_CONFIG_INVALID",
            500,
          );
        }

        if (retryableError && hasNextCandidate) {
          logGemini(config.logLevel, "info", "switching model candidate", {
            requestId,
            model,
            modelIndex: modelIndex + 1,
            candidateCount: modelCandidates.length,
            apiVersion: config.apiVersion,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            durationMs,
            status,
            errorCode: timeoutError ? "GEMINI_TIMEOUT" : "GEMINI_REQUEST_FAILED",
            errorName,
            errorMessageHead,
          });
          break;
        }

        if (error instanceof AppError) {
          logGemini(config.logLevel, "error", "app error", {
            requestId,
            model,
            modelIndex: modelIndex + 1,
            candidateCount: modelCandidates.length,
            apiVersion: config.apiVersion,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            durationMs,
            status,
            errorCode: error.code,
            errorName,
            errorMessageHead,
          });
          throw error;
        }

        if (timeoutError) {
          logGemini(config.logLevel, "error", "request timeout", {
            requestId,
            model,
            modelIndex: modelIndex + 1,
            candidateCount: modelCandidates.length,
            apiVersion: config.apiVersion,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            durationMs,
            status,
            errorCode: "GEMINI_TIMEOUT",
            errorName,
            errorMessageHead,
          });
          throw new AppError("Gemini 요청 시간이 초과되었습니다.", "GEMINI_TIMEOUT", 504);
        }

        if (error instanceof Error) {
          logGemini(config.logLevel, "error", "request failed", {
            requestId,
            model,
            modelIndex: modelIndex + 1,
            candidateCount: modelCandidates.length,
            apiVersion: config.apiVersion,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            durationMs,
            status,
            errorCode: "GEMINI_REQUEST_FAILED",
            errorName,
            errorMessageHead,
          });

          throw new AppError(
            `Gemini SDK 호출 실패${status ? ` (${status})` : ""}: ${error.message.slice(0, 240)}`,
            "GEMINI_REQUEST_FAILED",
            502,
          );
        }

        logGemini(config.logLevel, "error", "unknown error", {
          requestId,
          model,
          modelIndex: modelIndex + 1,
          candidateCount: modelCandidates.length,
          apiVersion: config.apiVersion,
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
          durationMs,
          status,
          errorCode: "GEMINI_UNKNOWN_ERROR",
          errorName,
          errorMessageHead,
        });

        throw new AppError(
          "Gemini 호출 중 알 수 없는 오류가 발생했습니다.",
          "GEMINI_UNKNOWN_ERROR",
          500,
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  throw new AppError(
    "Gemini 모델 후보에서 응답을 확보하지 못했습니다.",
    "GEMINI_REQUEST_FAILED",
    502,
  );
}
