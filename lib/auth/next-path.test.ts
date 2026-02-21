import { describe, expect, it } from "vitest";

import { sanitizeNextPath } from "@/lib/auth/next-path";

describe("sanitizeNextPath", () => {
  it("keeps valid internal path", () => {
    expect(sanitizeNextPath("/dashboard?tab=history")).toBe("/dashboard?tab=history");
  });

  it("falls back to default path when value is missing", () => {
    expect(sanitizeNextPath(undefined)).toBe("/dashboard");
    expect(sanitizeNextPath(null)).toBe("/dashboard");
  });

  it("blocks protocol-relative path", () => {
    expect(sanitizeNextPath("//evil.example/path")).toBe("/dashboard");
  });

  it("blocks non-internal path", () => {
    expect(sanitizeNextPath("https://evil.example/path")).toBe("/dashboard");
    expect(sanitizeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("supports custom fallback path", () => {
    expect(sanitizeNextPath("https://evil.example/path", "/")).toBe("/");
  });
});

