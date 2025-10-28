import { afterEach, describe, expect, it, vi } from "vitest";

import { __testables } from "../utils/api";

const originalFetch = globalThis.fetch;

describe("requestRefreshSession", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("posts to the refresh endpoint with CSRF header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accessToken: "next-token" }),
    } as unknown as Response);

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { requestRefreshSession } = __testables;
    const result = await requestRefreshSession("csrf-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/refresh",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "x-refresh-csrf": "csrf-token",
          Accept: "application/json",
        }),
      })
    );
    expect(result.accessToken).toBe("next-token");
  });

  it("throws RefreshTokenError on forbidden response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as unknown as Response);

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { requestRefreshSession } = __testables;

    await expect(requestRefreshSession("csrf-token")).rejects.toMatchObject({
      type: "RefreshTokenError",
    });
  });
});
