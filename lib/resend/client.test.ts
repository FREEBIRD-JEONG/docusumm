import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resendSendMock, ResendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const constructorMock = vi.fn(
    class {
      public readonly apiKey: string;
      public readonly emails: { send: typeof sendMock };

      constructor(apiKey: string) {
        this.apiKey = apiKey;
        this.emails = { send: sendMock };
      }
    },
  );

  return {
    resendSendMock: sendMock,
    ResendMock: constructorMock,
  };
});

vi.mock("resend", () => ({
  Resend: ResendMock,
}));

import { sendSummaryCompletedEmail } from "@/lib/resend/client";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_FROM_NAME",
  "NEXT_PUBLIC_APP_URL",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("sendSummaryCompletedEmail", () => {
  beforeEach(() => {
    resendSendMock.mockReset();
    ResendMock.mockClear();
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "onboarding@resend.dev";
    process.env.RESEND_FROM_NAME = "DocuSumm";
    process.env.NEXT_PUBLIC_APP_URL = "https://docusumm.example";
  });

  afterEach(() => {
    restoreEnv();
  });

  it("sends summary completion email with DocuSumm subject prefix", async () => {
    resendSendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });

    const result = await sendSummaryCompletedEmail({
      toEmail: "user@example.com",
      summaryId: "summary-1",
      summaryText: "TL;DR\n- 핵심 1\n- 핵심 2\n- 핵심 3\n\n전체 요약\n본문",
      originalContent: "https://www.youtube.com/watch?v=abc123def45",
      requestUrl: "http://localhost/api/internal/summary-worker",
    });

    expect(result).toEqual({ status: "sent" });
    expect(ResendMock).toHaveBeenCalledWith("re_test_key");
    expect(resendSendMock).toHaveBeenCalledTimes(1);

    const body = resendSendMock.mock.calls[0]?.[0] as {
      subject: string;
      from: string;
      to: string[];
      react: unknown;
    };
    expect(body.subject.startsWith("[DocuSumm]")).toBe(true);
    expect(body.from).toContain("DocuSumm");
    expect(body.to).toEqual(["user@example.com"]);
    expect(JSON.stringify(body.react)).toContain("summaryId=summary-1");
  });

  it("skips email when resend api key is missing", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendSummaryCompletedEmail({
      toEmail: "user@example.com",
      summaryId: "summary-1",
      summaryText: "TL;DR\n- a\n- b\n- c\n\n전체 요약\n본문",
      originalContent: "원문",
      requestUrl: "http://localhost/api/internal/summary-worker",
    });

    expect(result).toEqual({ status: "skipped", reason: "resend-config-missing" });
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("skips email for local.invalid recipient", async () => {
    const result = await sendSummaryCompletedEmail({
      toEmail: "guest-user@local.invalid",
      summaryId: "summary-1",
      summaryText: "TL;DR\n- a\n- b\n- c\n\n전체 요약\n본문",
      originalContent: "원문",
      requestUrl: "http://localhost/api/internal/summary-worker",
    });

    expect(result).toEqual({ status: "skipped", reason: "invalid-recipient" });
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("throws RESEND_SEND_FAILED when resend api call fails", async () => {
    resendSendMock.mockResolvedValue({
      data: null,
      error: { message: "bad request" },
    } as never);

    await expect(
      sendSummaryCompletedEmail({
        toEmail: "user@example.com",
        summaryId: "summary-1",
        summaryText: "TL;DR\n- a\n- b\n- c\n\n전체 요약\n본문",
        originalContent: "원문",
        requestUrl: "http://localhost/api/internal/summary-worker",
      }),
    ).rejects.toThrow("[RESEND_SEND_FAILED]");
  });
});
