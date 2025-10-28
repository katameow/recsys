import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthError } from "@/lib/auth-errors";
import { requestGuestSession } from "@/lib/guest-auth";
import { makeGuestRequest } from "@/utils/api";

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

vi.mock("@/utils/api", () => ({
  makeGuestRequest: vi.fn(),
}));

const mockedMakeGuestRequest = vi.mocked(makeGuestRequest);

describe("requestGuestSession", () => {
  beforeEach(() => {
    mockedMakeGuestRequest.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes snake_case payloads and derives expiry", async () => {
    vi.useFakeTimers();
    const baseTime = new Date("2025-09-28T12:00:00Z");
    vi.setSystemTime(baseTime);

    mockedMakeGuestRequest.mockResolvedValue({
      access_token: "guest-token",
      expires_in: 3600,
      user: {
        id: "guest-123",
        email: "guest@example.com",
      },
    });

    const session = await requestGuestSession();

    expect(session.accessToken).toBe("guest-token");
    expect(session.user.role).toBe("guest");
    expect(session.user.id).toBe("guest-123");
    expect(session.expiresAt).toBe(baseTime.getTime() + 3_600_000);
  });

  it("defaults role to guest when API omits role", async () => {
    mockedMakeGuestRequest.mockResolvedValue({
      accessToken: "guest-token",
      user: {
        name: "Anonymous",
      },
    });

    const session = await requestGuestSession();

    expect(session.accessToken).toBe("guest-token");
    expect(session.user.role).toBe("guest");
    expect(session.user.name).toBe("Anonymous");
  });

  it("throws ValidationError when token is missing", async () => {
    mockedMakeGuestRequest.mockResolvedValue({
      user: {
        role: "guest",
      },
    });

    await expect(requestGuestSession()).rejects.toMatchObject({
      type: "ValidationError",
    });
  });

  it("rethrows auth-aware errors from makeGuestRequest", async () => {
    const authError = createAuthError("NetworkError", "offline");
    mockedMakeGuestRequest.mockRejectedValue(authError);

    await expect(requestGuestSession()).rejects.toBe(authError);
  });

  it("normalizes unexpected failures via parseApiError", async () => {
    mockedMakeGuestRequest.mockRejectedValue(new Error("service unavailable"));

    await expect(requestGuestSession()).rejects.toMatchObject({
      type: "ValidationError",
      message: "service unavailable",
    });
  });
});
