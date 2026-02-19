import { describe, expect, it } from "vitest";

import { isValidYouTubeUrl, normalizeYouTubeUrl } from "./youtube";

describe("normalizeYouTubeUrl", () => {
  it("normalizes watch URL", () => {
    expect(normalizeYouTubeUrl("https://www.youtube.com/watch?v=twsx6DvIvBE")).toBe(
      "https://www.youtube.com/watch?v=twsx6DvIvBE",
    );
  });

  it("normalizes youtu.be short URL", () => {
    expect(normalizeYouTubeUrl("https://youtu.be/twsx6DvIvBE")).toBe(
      "https://www.youtube.com/watch?v=twsx6DvIvBE",
    );
  });

  it("accepts URL without protocol", () => {
    expect(normalizeYouTubeUrl("youtube.com/watch?v=twsx6DvIvBE")).toBe(
      "https://www.youtube.com/watch?v=twsx6DvIvBE",
    );
  });

  it("extracts URL from mixed text", () => {
    expect(normalizeYouTubeUrl("이 영상 요약해줘: https://youtu.be/twsx6DvIvBE")).toBe(
      "https://www.youtube.com/watch?v=twsx6DvIvBE",
    );
  });

  it("returns null for non-youtube URL", () => {
    expect(normalizeYouTubeUrl("https://example.com/article")).toBeNull();
  });

  it("returns null for invalid video id", () => {
    expect(normalizeYouTubeUrl("https://youtu.be/abc")).toBeNull();
  });
});

describe("isValidYouTubeUrl", () => {
  it("returns true for valid URL", () => {
    expect(isValidYouTubeUrl("https://youtu.be/twsx6DvIvBE")).toBe(true);
  });

  it("returns false for invalid input", () => {
    expect(isValidYouTubeUrl("not-a-url")).toBe(false);
  });
});
