import { toUserFacingErrorMessage } from "@/lib/errors/error-messages";
import type { CreditPackageId } from "@/lib/stripe/packages";
import type { SourceType, SummaryRecord, SummaryStatus } from "@/types/summary";

interface ApiErrorData {
  error?: string;
  code?: string;
}

interface CreateSummaryResponse {
  id: string;
  status: SummaryStatus;
  summary: string | null;
  remainingCredits?: number;
}

interface AccountProfileResponse {
  id: string;
  email: string;
  credits: number;
}

export interface CreateCheckoutSessionResponse {
  url: string;
  sessionId: string;
}

export interface ConfirmCheckoutSessionResponse {
  received: boolean;
  handled: boolean;
  paid?: boolean;
  processed?: boolean;
  duplicate?: boolean;
  newCredits?: number | null;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(params: { status: number; code?: string | null; message: string }) {
    super(params.message);
    this.name = "ApiClientError";
    this.status = params.status;
    this.code = params.code ?? null;
  }
}

function parseErrorMessage(status: number, data: ApiErrorData | null, fallback: string): string {
  if (status === 401) {
    return "로그인이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요.";
  }

  if (data?.code) {
    return toUserFacingErrorMessage(data.code, fallback);
  }

  return toUserFacingErrorMessage(data?.error, fallback);
}

async function readErrorData(response: Response): Promise<ApiErrorData | null> {
  return (await response.json().catch(() => null)) as ApiErrorData | null;
}

async function requestJson<T>(input: string, init: RequestInit, fallbackError: string): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const errorData = await readErrorData(response);
    throw new ApiClientError({
      status: response.status,
      code: errorData?.code ?? null,
      message: parseErrorMessage(response.status, errorData, fallbackError),
    });
  }

  return (await response.json()) as T;
}

export async function createSummaryRequest(
  sourceType: SourceType,
  content: string,
): Promise<CreateSummaryResponse> {
  return requestJson<CreateSummaryResponse>(
    "/api/summary",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType, content }),
    },
    "요약 요청에 실패했습니다.",
  );
}

export async function getSummaryById(id: string): Promise<SummaryRecord> {
  const data = await requestJson<{ record?: SummaryRecord; summary?: SummaryRecord }>(
    `/api/summaries/${id}`,
    { cache: "no-store" },
    "요약 상태 조회에 실패했습니다.",
  );

  const record = data.record ?? data.summary;
  if (!record) {
    throw new ApiClientError({
      status: 500,
      code: "SUMMARY_RESPONSE_INVALID",
      message: "요약 응답 형식이 올바르지 않습니다.",
    });
  }
  return record;
}

export async function getRecentSummaries(limit = 30): Promise<SummaryRecord[]> {
  const data = await requestJson<{ items: SummaryRecord[] }>(
    `/api/summaries?limit=${limit}`,
    { cache: "no-store" },
    "히스토리 조회에 실패했습니다.",
  );
  return data.items;
}

export async function deleteAllSummariesRequest(): Promise<number> {
  const data = await requestJson<{ deletedCount?: number }>(
    "/api/summaries",
    { method: "DELETE" },
    "히스토리 전체 삭제에 실패했습니다.",
  );
  return Number.isFinite(data.deletedCount) ? Number(data.deletedCount) : 0;
}

export async function cancelSummaryRequest(id: string): Promise<SummaryRecord> {
  const data = await requestJson<{ record?: SummaryRecord }>(
    `/api/summaries/${id}/cancel`,
    { method: "POST" },
    "요약 취소에 실패했습니다.",
  );
  if (!data.record) {
    throw new ApiClientError({
      status: 500,
      code: "SUMMARY_RESPONSE_INVALID",
      message: "요약 취소 응답 형식이 올바르지 않습니다.",
    });
  }
  return data.record;
}

export async function getAccountProfileRequest(): Promise<AccountProfileResponse> {
  return requestJson<AccountProfileResponse>("/api/account", { cache: "no-store" }, "계정 정보 조회에 실패했습니다.");
}

export async function createCheckoutSessionRequest(
  packageId: CreditPackageId,
): Promise<CreateCheckoutSessionResponse> {
  return requestJson<CreateCheckoutSessionResponse>(
    "/api/payments/checkout",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    },
    "결제 세션 생성에 실패했습니다.",
  );
}

export async function confirmCheckoutSessionRequest(
  sessionId: string,
): Promise<ConfirmCheckoutSessionResponse> {
  return requestJson<ConfirmCheckoutSessionResponse>(
    "/api/payments/confirm",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    },
    "결제 상태 확인에 실패했습니다.",
  );
}
