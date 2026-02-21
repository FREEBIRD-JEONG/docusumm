const DEFAULT_FROM_EMAIL = "onboarding@resend.dev";
const DEFAULT_FROM_NAME = "DocuSumm";

export interface ResendRuntimeConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

export function getResendRuntimeConfig(): ResendRuntimeConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    fromEmail: process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL,
    fromName: process.env.RESEND_FROM_NAME?.trim() || DEFAULT_FROM_NAME,
  };
}
