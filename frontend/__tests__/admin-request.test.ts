import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/lib/auth-store";

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

const requestSpy = vi.hoisted(() => vi.fn().mockResolvedValue({ data: {} }));

vi.mock("axios", () => {
  const create = vi.fn(() => ({
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
    request: requestSpy,
    get: requestSpy,
  }));

  const axiosInstance = Object.assign(requestSpy, {
    create,
    request: requestSpy,
    isAxiosError: () => false,
  });

  class AxiosError extends Error {}

  return {
    __esModule: true,
    default: axiosInstance,
    create,
    request: requestSpy,
    isAxiosError: () => false,
    AxiosError,
  };
});

import * as apiModule from "@/utils/api";

const resetStore = () => {
  useAuthStore.setState({
    status: "unauthenticated",
    accessToken: undefined,
    expiresAt: undefined,
    user: undefined,
    refreshCsrf: undefined,
  });
};

describe("makeAdminRequest", () => {
  beforeEach(() => {
    resetStore();
    requestSpy.mockReset();
    requestSpy.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    resetStore();
  });

  it("rejects when the active user is not an admin", async () => {
    useAuthStore.setState({
      status: "authenticated",
      user: { role: "guest" },
      accessToken: "guest-token",
    });

    await expect(
      apiModule.makeAdminRequest({
        url: "/admin/status",
        method: "GET",
      })
    ).rejects.toMatchObject({
      type: "AccessDenied",
      message: "Access forbidden",
    });
  });

  it("delegates to authenticated request when user is admin", async () => {
    requestSpy.mockResolvedValue({ data: { ok: true } });

    useAuthStore.setState({
      status: "authenticated",
      user: { role: "admin" },
      accessToken: "admin-token",
    });

    const payload = await apiModule.makeAdminRequest<{ ok: boolean }>({
      url: "/admin/status",
      method: "GET",
    });

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/admin/status",
        method: "GET",
      })
    );
    expect(payload).toEqual({ ok: true });
  });
});
