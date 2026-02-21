import {
  SummaryCompletedEmail,
  type SummaryCompletedEmailProps,
} from "../lib/resend/templates/summary-completed-email";

export const sampleSummaryCompletedEmailProps: SummaryCompletedEmailProps = {
  summaryTitle: "OpenAI Dev Day 2026 키노트 요약",
  tldrItems: [
    "새로운 모델 출시 로드맵과 API 변경 포인트를 한 번에 파악할 수 있습니다.",
    "개발팀이 바로 적용할 수 있는 마이그레이션 체크리스트가 포함되어 있습니다.",
    "비용/성능 관점의 핵심 비교를 정리해 의사결정을 빠르게 지원합니다.",
  ],
  summaryLink: "http://localhost:3000/dashboard?summaryId=demo-summary-2026-021",
};

export default function SummaryCompletedEmailPreview(props: Partial<SummaryCompletedEmailProps>) {
  return (
    <SummaryCompletedEmail
      summaryTitle={props.summaryTitle ?? sampleSummaryCompletedEmailProps.summaryTitle}
      tldrItems={props.tldrItems ?? sampleSummaryCompletedEmailProps.tldrItems}
      summaryLink={props.summaryLink ?? sampleSummaryCompletedEmailProps.summaryLink}
    />
  );
}

SummaryCompletedEmailPreview.PreviewProps = sampleSummaryCompletedEmailProps;
