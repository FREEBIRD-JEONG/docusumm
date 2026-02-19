import type { SummaryRecord } from "@/types/summary";

export const mockSummaries: SummaryRecord[] = [
  {
    id: "mock-1",
    userId: null,
    sourceType: "text",
    originalContent:
      "The company announced a new product roadmap focused on reliability, faster updates, and better onboarding for enterprise teams.",
    summaryText:
      "DocuSumm mock summary:\n1. 제품 로드맵의 핵심은 안정성 개선이다.\n2. 배포 주기를 단축해 기능 출시 속도를 높인다.\n3. 엔터프라이즈 온보딩을 단순화해 초기 도입 장벽을 낮춘다.",
    status: "completed",
    errorMessage: null,
    createdAt: "2026-02-12T12:56:13.000Z",
    updatedAt: "2026-02-12T12:56:13.000Z",
  },
  {
    id: "mock-2",
    userId: null,
    sourceType: "youtube",
    originalContent: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    summaryText:
      "DocuSumm mock summary:\n1. 영상의 주요 메시지를 세 개의 포인트로 정리한다.\n2. 핵심 장면을 맥락과 함께 요약한다.\n3. 후속 행동을 위한 체크리스트를 제시한다.",
    status: "completed",
    errorMessage: null,
    createdAt: "2026-02-12T13:46:13.000Z",
    updatedAt: "2026-02-12T13:46:13.000Z",
  },
];
