import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { __testables } from "./transcript";

describe("youtube transcript parsers", () => {
  it("ranks caption tracks by preferred language and human subtitles", () => {
    const ranked = __testables.rankCaptionTracks([
      { baseUrl: "https://example.test/1", languageCode: "en", kind: "asr" },
      { baseUrl: "https://example.test/2", languageCode: "ko", kind: "asr" },
      { baseUrl: "https://example.test/3", languageCode: "en" },
      { baseUrl: "https://example.test/4", languageCode: "ja" },
    ]);

    expect(ranked.map((track) => `${track.languageCode ?? ""}:${track.kind ?? ""}`)).toEqual([
      "ko:asr",
      "en:",
      "en:asr",
      "ja:",
    ]);
  });

  it("parses json3 transcript payload", () => {
    const body = JSON.stringify({
      events: [
        { segs: [{ utf8: "안녕하세요" }, { utf8: " 여러분" }] },
        { segs: [{ utf8: "테스트입니다." }] },
      ],
    });

    const transcript = __testables.parseTranscriptFromBody(body, "application/json; charset=utf-8");
    expect(transcript).toBe("안녕하세요 여러분 테스트입니다.");
  });

  it("parses xml transcript payload", () => {
    const body = [
      '<transcript>',
      '<text start="0.1" dur="1.2">Hello &amp; welcome</text>',
      '<text start="1.3" dur="1.2">to &#39;DocuSumm&#39;.</text>',
      "</transcript>",
    ].join("");

    const transcript = __testables.parseTranscriptFromBody(body, "text/xml");
    expect(transcript).toBe("Hello & welcome to 'DocuSumm'.");
  });

  it("parses vtt transcript payload", () => {
    const body = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:01.000",
      "First line",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "<c>Second line</c>",
    ].join("\n");

    const transcript = __testables.parseTranscriptFromBody(body, "text/vtt");
    expect(transcript).toBe("First line Second line");
  });

  it("drops vtt metadata headers and cue settings lines", () => {
    const body = [
      "WEBVTT",
      "Kind: captions",
      "Language: ko",
      "",
      "00:00:00.000 --> 00:00:01.000 align:start position:0%",
      "첫 문장",
      "",
      "00:00:01.000 --> 00:00:02.000 line:90%",
      "둘째 문장",
    ].join("\n");

    const transcript = __testables.parseTranscriptFromBody(body, "text/vtt");
    expect(transcript).toBe("첫 문장 둘째 문장");
  });

  it("prefers best parsed subtitle file from yt-dlp output directory", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "docusumm-transcript-test-"));
    try {
      await writeFile(
        join(workDir, "sample.en.vtt"),
        ["WEBVTT", "", "00:00:00.000 --> 00:00:01.000", "English line"].join("\n"),
      );
      await writeFile(
        join(workDir, "sample.ko.vtt"),
        ["WEBVTT", "", "00:00:00.000 --> 00:00:01.000", "한국어 줄"].join("\n"),
      );

      const result = await __testables.parseBestSubtitleFile(workDir);
      expect(result.vttCount).toBe(2);
      expect(result.parsed?.file).toBe("sample.ko.vtt");
      expect(result.parsed?.transcript).toBe("한국어 줄");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
