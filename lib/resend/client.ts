import { Resend } from "resend";

import { getResendRuntimeConfig } from "@/lib/resend/config";
import {
  buildSummaryCompletedSubject,
  SummaryCompletedEmail,
} from "@/lib/resend/templates/summary-completed-email";
import { fetchYouTubeTitle } from "@/lib/youtube/title";
import { deriveSummaryTitle, extractTldr } from "@/types/summary";

type EmailSkipReason = "invalid-recipient" | "resend-config-missing";

interface SendSummaryCompletedEmailInput {
  toEmail: string | null | undefined;
  summaryId: string;
  summaryText: string;
  originalContent: string;
  requestUrl: string;
}

export type SendSummaryCompletedEmailResult =
  | { status: "sent" }
  | { status: "skipped"; reason: EmailSkipReason };

function isDeliverableEmail(value: string): boolean {
  if (!value || value.includes(" ")) {
    return false;
  }

  if (value.toLowerCase().endsWith("@local.invalid")) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function resolveAppBaseUrl(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).toString().replace(/\/$/, "");
    } catch {
      // malformed override fallback
    }
  }

  try {
    return new URL(requestUrl).origin;
  } catch {
    return "http://localhost";
  }
}

function normalizeTldrItems(summaryText: string): string[] {
  return extractTldr(summaryText)
    .map((item) => item.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

async function resolveSummaryTitle(originalContent: string): Promise<string> {
  const fallbackTitle = deriveSummaryTitle(originalContent);

  try {
    const youtubeTitle = await fetchYouTubeTitle(originalContent);
    if (youtubeTitle?.title) {
      return youtubeTitle.title;
    }
  } catch {
    // Ignore YouTube title lookup failures and keep fallback title.
  }

  return fallbackTitle;
}

export async function sendSummaryCompletedEmail(
  input: SendSummaryCompletedEmailInput,
): Promise<SendSummaryCompletedEmailResult> {
  const toEmail = input.toEmail?.trim() ?? "";
  if (!isDeliverableEmail(toEmail)) {
    return { status: "skipped", reason: "invalid-recipient" };
  }

  const config = getResendRuntimeConfig();
  if (!config) {
    return { status: "skipped", reason: "resend-config-missing" };
  }

  const summaryLink = `${resolveAppBaseUrl(input.requestUrl)}/dashboard?summaryId=${encodeURIComponent(input.summaryId)}`;
  const summaryTitle = await resolveSummaryTitle(input.originalContent);
  const subject = buildSummaryCompletedSubject({ summaryTitle });
  const tldrItems = normalizeTldrItems(input.summaryText);
  const resend = new Resend(config.apiKey);

  try {
    const response = await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [toEmail],
      subject,
      react: SummaryCompletedEmail({
        summaryTitle,
        tldrItems,
        summaryLink,
      }),
    });

    if (response.error) {
      throw new Error(`Resend API request failed: ${response.error.message}`);
    }

    return { status: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`[RESEND_SEND_FAILED] ${message}`);
  }
}
