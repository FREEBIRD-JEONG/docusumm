import { describe, expect, it } from "vitest";

import { extractFullSummaryText, extractTldr } from "./summary";

describe("extractTldr", () => {
  it("extracts bullets only from TL;DR section", () => {
    const summary = [
      "TL;DR",
      "- 핵심 1",
      "- 핵심 2",
      "- 핵심 3",
      "",
      "전체 요약",
      "본문 문장입니다.",
      "- 본문 bullet은 TL;DR로 취급하면 안 됩니다.",
    ].join("\n");

    expect(extractTldr(summary)).toEqual(["- 핵심 1", "- 핵심 2", "- 핵심 3"]);
  });

  it("falls back to first three sentences when TL;DR section is missing", () => {
    const summary = "첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다.";

    expect(extractTldr(summary)).toEqual([
      "첫 번째 문장입니다.",
      "두 번째 문장입니다.",
      "세 번째 문장입니다.",
    ]);
  });
});

describe("extractFullSummaryText", () => {
  it("returns body under 전체 요약 section", () => {
    const summary = [
      "TL;DR",
      "- 핵심 1",
      "- 핵심 2",
      "- 핵심 3",
      "",
      "전체 요약",
      "첫 문장",
      "둘째 문장",
    ].join("\n");

    expect(extractFullSummaryText(summary)).toBe("첫 문장\n둘째 문장");
  });

  it("falls back to original when 전체 요약 section is missing", () => {
    const summary = "섹션 없는 요약 본문";
    expect(extractFullSummaryText(summary)).toBe(summary);
  });
});
