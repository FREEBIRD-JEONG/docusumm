const CODE_MESSAGE_MAP: Record<string, string> = {
  SUMMARY_CANCELED: "요약이 사용자 요청으로 취소되었습니다.",
  FALLBACK_OUTPUT_INVALID: "대체 요약 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  GEMINI_TIMEOUT: "요약 처리 시간이 초과되었습니다. 다시 시도해 주세요.",
  MISSING_GEMINI_KEY: "서버 설정 오류로 요약할 수 없습니다. 관리자에게 문의해 주세요.",
  GEMINI_REQUEST_FAILED:
    "요약 모델 호출이 제한되었습니다(429 가능). 잠시 후 다시 시도하고 API 키/쿼터를 확인해 주세요.",
  GEMINI_EMPTY_RESPONSE: "요약 결과를 생성하지 못했습니다. 다시 시도해 주세요.",
  GEMINI_OUTPUT_INVALID: "요약 결과 형식이 올바르지 않아 다시 요청해 주세요.",
  GEMINI_CONFIG_INVALID:
    "요약 모델 설정이 올바르지 않습니다. GEMINI_MODEL/GEMINI_MODEL_CANDIDATES를 확인해 주세요.",
  YOUTUBE_URL_INVALID: "유효한 YouTube URL을 확인해 주세요.",
  YOUTUBE_METADATA_FETCH_FAILED: "YouTube 영상 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  YOUTUBE_TRANSCRIPT_FETCH_FAILED: "YouTube 자막을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  YOUTUBE_TRANSCRIPT_BLOCKED: "YouTube 서버 차단으로 자막을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  YOUTUBE_TRANSCRIPT_UNAVAILABLE: "이 영상은 사용 가능한 자막이 없어 요약할 수 없습니다.",
};

const ERROR_CODE_PATTERN = /\[([A-Z0-9_]+)\]/;

export function extractErrorCode(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const match = raw.match(ERROR_CODE_PATTERN);
  return match?.[1] ?? null;
}

export function toUserFacingErrorMessage(
  rawMessage: string | null | undefined,
  fallbackMessage: string,
): string {
  if (!rawMessage) {
    return fallbackMessage;
  }

  const code = extractErrorCode(rawMessage);
  if (code && CODE_MESSAGE_MAP[code]) {
    return CODE_MESSAGE_MAP[code];
  }

  if (CODE_MESSAGE_MAP[rawMessage]) {
    return CODE_MESSAGE_MAP[rawMessage];
  }

  return rawMessage;
}
