import type { SourceType } from "@/types/summary";

function getCommonRules() {
  return [
    "출력 언어는 반드시 한국어로 작성한다.",
    "출력은 반드시 일반 텍스트로만 작성하고 코드 블록/JSON/마크다운 테이블은 사용하지 않는다.",
    "추측, 과장, 근거 없는 사실 생성(환각)을 금지한다.",
    "입력에 없는 사실을 만들어내지 않는다.",
    "반드시 아래 출력 형식을 정확히 지킨다:",
    "TL;DR",
    "- 핵심 포인트 1",
    "- 핵심 포인트 2",
    "- 핵심 포인트 3",
    "",
    "전체 요약",
    "입력 내용을 구조적으로 정리한 본문",
    "TL;DR 섹션의 bullet은 정확히 3개여야 한다.",
  ].join("\n");
}

export function buildSummaryPrompt(sourceType: SourceType, content: string): string {
  const shared = getCommonRules();

  if (sourceType === "youtube") {
    return [
      "당신은 YouTube 콘텐츠를 요약하는 전문 어시스턴트다.",
      shared,
      "입력에는 YouTube URL, 영상 제목, 영상 자막 텍스트가 포함된다.",
      "요약은 반드시 제공된 자막 텍스트에 근거해서 작성한다.",
      "자막에 없는 사실은 추정하지 않는다.",
      "가능하면 영상의 주제, 핵심 주장, 근거, 결론을 중심으로 요약한다.",
      "",
      "입력 데이터:",
      content,
    ].join("\n");
  }

  return [
    "당신은 장문 텍스트를 요약하는 전문 어시스턴트다.",
    shared,
    "텍스트의 핵심 주장, 근거, 결론 흐름을 중심으로 요약한다.",
    "",
    "입력 텍스트:",
    content,
  ].join("\n");
}
