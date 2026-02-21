import { describe, expect, it } from "vitest";

import { extractErrorCode, toUserFacingErrorMessage } from "./error-messages";

describe("extractErrorCode", () => {
  it("extracts bracketed error code", () => {
    expect(extractErrorCode("[GEMINI_TIMEOUT] request timed out")).toBe("GEMINI_TIMEOUT");
  });

  it("returns null when code is missing", () => {
    expect(extractErrorCode("plain error message")).toBeNull();
  });
});

describe("toUserFacingErrorMessage", () => {
  it("maps known error code in message", () => {
    expect(toUserFacingErrorMessage("[SUMMARY_CANCELED] canceled by user", "fallback")).toBe(
      "요약이 사용자 요청으로 취소되었습니다.",
    );
  });

  it("maps known code-only message", () => {
    expect(toUserFacingErrorMessage("GEMINI_REQUEST_FAILED", "fallback")).toBe(
      "요약 모델 호출이 반복 실패했습니다. 요청은 실패 처리되었고 차감된 크레딧은 환불되었습니다.",
    );
  });

  it("maps gemini config error message", () => {
    expect(toUserFacingErrorMessage("GEMINI_CONFIG_INVALID", "fallback")).toBe(
      "요약 모델 설정이 올바르지 않습니다. GEMINI_MODEL/GEMINI_MODEL_CANDIDATES를 확인해 주세요.",
    );
  });

  it("returns fallback when message is empty", () => {
    expect(toUserFacingErrorMessage("", "fallback")).toBe("fallback");
  });

  it("returns original message for unknown code", () => {
    expect(toUserFacingErrorMessage("[UNKNOWN_CODE] detail", "fallback")).toBe(
      "[UNKNOWN_CODE] detail",
    );
  });
});
