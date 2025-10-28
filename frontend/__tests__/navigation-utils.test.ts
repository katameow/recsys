import { describe, expect, it } from "vitest";

import { DEFAULT_AUTH_REDIRECT, sanitizeRedirectPath } from "@/lib/navigation";

describe("sanitizeRedirectPath", () => {
  it("returns default for empty values", () => {
    expect(sanitizeRedirectPath("")).toBe(DEFAULT_AUTH_REDIRECT);
    expect(sanitizeRedirectPath(null)).toBe(DEFAULT_AUTH_REDIRECT);
    expect(sanitizeRedirectPath(undefined)).toBe(DEFAULT_AUTH_REDIRECT);
  });

  it("strips protocol for absolute URLs", () => {
    expect(sanitizeRedirectPath("https://example.com/profile")).toBe("/profile");
    expect(sanitizeRedirectPath("http://example.com/orders?id=2")).toBe("/orders?id=2");
  });

  it("ignores protocol-relative URLs", () => {
    expect(sanitizeRedirectPath("//evil.com")).toBe(DEFAULT_AUTH_REDIRECT);
  });

  it("enforces leading slash", () => {
    expect(sanitizeRedirectPath("dashboard")).toBe(DEFAULT_AUTH_REDIRECT);
  });

  it("allows safe relative paths", () => {
    expect(sanitizeRedirectPath("/chat")).toBe("/chat");
  });
});
