import { AppError } from "@/lib/errors/app-error";

type GeminiLogLevel = "info" | "debug";

interface GeminiRuntimeConfig {
  model: string;
  modelCandidates: string[];
  apiVersion: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  logLevel: GeminiLogLevel;
}

const DEFAULTS = {
  model: "gemini-2.0-flash",
  apiVersion: "v1",
  timeoutMs: 45_000,
  maxRetries: 2,
  retryBaseDelayMs: 700,
  maxOutputTokens: 1200,
  temperature: 0.2,
  topP: 0.9,
  logLevel: "info" as GeminiLogLevel,
};

function parseIntegerConfig(name: string, rawValue: string | undefined, fallback: number): number {
  if (!rawValue || rawValue.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(
      `${name} 설정값이 올바르지 않습니다. 양의 정수를 입력해 주세요.`,
      "GEMINI_CONFIG_INVALID",
      500,
    );
  }

  return parsed;
}

function parseNumberConfig(
  name: string,
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!rawValue || rawValue.trim() === "") {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new AppError(
      `${name} 설정값이 올바르지 않습니다. ${min} 이상 ${max} 이하 숫자를 입력해 주세요.`,
      "GEMINI_CONFIG_INVALID",
      500,
    );
  }

  return parsed;
}

function parseLogLevel(rawValue: string | undefined): GeminiLogLevel {
  if (!rawValue || rawValue.trim() === "") {
    return DEFAULTS.logLevel;
  }

  const normalized = rawValue.toLowerCase();
  if (normalized === "info" || normalized === "debug") {
    return normalized;
  }

  throw new AppError(
    "GEMINI_LOG_LEVEL 설정값이 올바르지 않습니다. info 또는 debug만 허용됩니다.",
    "GEMINI_CONFIG_INVALID",
    500,
  );
}

function parseModelCandidates(rawValue: string | undefined, fallbackModel: string): string[] {
  if (!rawValue || rawValue.trim() === "") {
    return [fallbackModel];
  }

  const uniqueCandidates = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);

  if (uniqueCandidates.length === 0) {
    return [fallbackModel];
  }

  return uniqueCandidates;
}

export function getGeminiRuntimeConfig(): GeminiRuntimeConfig {
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULTS.model;
  const modelCandidates = parseModelCandidates(process.env.GEMINI_MODEL_CANDIDATES, model);
  const apiVersion = process.env.GEMINI_API_VERSION?.trim() || DEFAULTS.apiVersion;
  const timeoutMs = parseIntegerConfig("GEMINI_TIMEOUT_MS", process.env.GEMINI_TIMEOUT_MS, DEFAULTS.timeoutMs);
  const maxRetries = parseIntegerConfig(
    "GEMINI_MAX_RETRIES",
    process.env.GEMINI_MAX_RETRIES,
    DEFAULTS.maxRetries,
  );
  const retryBaseDelayMs = parseIntegerConfig(
    "GEMINI_RETRY_BASE_DELAY_MS",
    process.env.GEMINI_RETRY_BASE_DELAY_MS,
    DEFAULTS.retryBaseDelayMs,
  );
  const maxOutputTokens = parseIntegerConfig(
    "GEMINI_MAX_OUTPUT_TOKENS",
    process.env.GEMINI_MAX_OUTPUT_TOKENS,
    DEFAULTS.maxOutputTokens,
  );
  const temperature = parseNumberConfig(
    "GEMINI_TEMPERATURE",
    process.env.GEMINI_TEMPERATURE,
    DEFAULTS.temperature,
    0,
    2,
  );
  const topP = parseNumberConfig("GEMINI_TOP_P", process.env.GEMINI_TOP_P, DEFAULTS.topP, 0, 1);
  const logLevel = parseLogLevel(process.env.GEMINI_LOG_LEVEL);

  return {
    model,
    modelCandidates,
    apiVersion,
    timeoutMs,
    maxRetries,
    retryBaseDelayMs,
    maxOutputTokens,
    temperature,
    topP,
    logLevel,
  };
}
