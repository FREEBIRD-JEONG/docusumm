import type { SourceType, SummaryRecord, SummaryStatus } from "@/types/summary";
import { toUserFacingErrorMessage } from "@/lib/errors/error-messages";

interface CreateSummaryResponse {
  id: string;
  status: SummaryStatus;
  summary: string | null;
}

function parseErrorMessage(
  status: number,
  data: { error?: string; code?: string } | null,
  fallback: string,
): string {
  if (status === 401) {
    return "로그인이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요.";
  }

  if (data?.code) {
    return toUserFacingErrorMessage(data.code, fallback);
  }

  return toUserFacingErrorMessage(data?.error, fallback);
}

export async function createSummaryRequest(
  sourceType: SourceType,
  content: string,
): Promise<CreateSummaryResponse> {
  const response = await fetch("/api/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType, content }),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw new Error(parseErrorMessage(response.status, errorData, "요약 요청에 실패했습니다."));
  }

  return (await response.json()) as CreateSummaryResponse;
}

export async function getSummaryById(id: string): Promise<SummaryRecord> {
  const response = await fetch(`/api/summaries/${id}`, { cache: "no-store" });
  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw new Error(parseErrorMessage(response.status, errorData, "요약 상태 조회에 실패했습니다."));
  }

  const data = (await response.json()) as { record?: SummaryRecord; summary?: SummaryRecord };
  const record = data.record ?? data.summary;
  if (!record) {
    throw new Error("요약 응답 형식이 올바르지 않습니다.");
  }
  return record;
}

export async function getRecentSummaries(limit = 30): Promise<SummaryRecord[]> {
  const response = await fetch(`/api/summaries?limit=${limit}`, { cache: "no-store" });
  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw new Error(parseErrorMessage(response.status, errorData, "히스토리 조회에 실패했습니다."));
  }

  const data = (await response.json()) as { items: SummaryRecord[] };
  return data.items;
}

export async function cancelSummaryRequest(id: string): Promise<SummaryRecord> {
  const response = await fetch(`/api/summaries/${id}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw new Error(parseErrorMessage(response.status, errorData, "요약 취소에 실패했습니다."));
  }

  const data = (await response.json()) as { record?: SummaryRecord };
  if (!data.record) {
    throw new Error("요약 취소 응답 형식이 올바르지 않습니다.");
  }

  return data.record;
}
