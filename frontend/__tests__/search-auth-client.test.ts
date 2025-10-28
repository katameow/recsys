import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/lib/auth-store";
import { submitSearchJob } from "../utils/api";

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

const axiosState = vi.hoisted(() => ({
  capturedConfigs: [] as unknown[],
  requestHandlers: [] as Array<(config: any) => any>,
  responseHandlers: [] as Array<{ onFulfilled?: (response: any) => any; onRejected?: (error: any) => any }>,
}));

const runRequestInterceptors = async (config: any) => {
  let current = config;
  for (const handler of axiosState.requestHandlers) {
    current = await handler(current);
  }
  return current;
};

const runResponseInterceptors = async (response: any) => {
  let current = response;
  for (const handler of axiosState.responseHandlers) {
    if (handler.onFulfilled) {
      current = await handler.onFulfilled(current);
    }
  }
  return current;
};

vi.mock("axios", () => {
  const client = {
    interceptors: {
      request: {
        use: (onFulfilled: (config: any) => any) => {
          axiosState.requestHandlers.push(onFulfilled);
          return axiosState.requestHandlers.length - 1;
        },
        eject: vi.fn(),
      },
      response: {
        use: (onFulfilled?: (response: any) => any, onRejected?: (error: any) => any) => {
          axiosState.responseHandlers.push({ onFulfilled, onRejected });
          return axiosState.responseHandlers.length - 1;
        },
        eject: vi.fn(),
      },
    },
    get: vi.fn(async (url: string, config: any = {}) => {
      const mergedConfig = {
        ...config,
        url,
        method: "get",
        headers: config.headers ?? {},
      };
      const finalConfig = await runRequestInterceptors(mergedConfig);
      axiosState.capturedConfigs.push(finalConfig);
      const response = { data: { count: 0 }, config: finalConfig };
      return runResponseInterceptors(response);
    }),
    request: vi.fn(async (config: any = {}) => {
      const mergedConfig = {
        ...config,
        method: config?.method ?? "get",
        headers: config?.headers ?? {},
      };
      const finalConfig = await runRequestInterceptors(mergedConfig);
      axiosState.capturedConfigs.push(finalConfig);
      const response = { data: {}, config: finalConfig };
      return runResponseInterceptors(response);
    }),
  };

  const create = vi.fn(() => client);

  const axiosMock = {
    create,
    request: client.request,
    get: client.get,
    isAxiosError: () => false,
  };

  return {
    __esModule: true,
    default: axiosMock,
    create,
    request: client.request,
    get: client.get,
    isAxiosError: () => false,
    AxiosError: class AxiosError extends Error {},
  };
});

const resetStore = () => {
  useAuthStore.setState({
    status: "unauthenticated",
    accessToken: undefined,
    expiresAt: undefined,
    user: undefined,
    refreshCsrf: undefined,
  });
};

describe("searchProducts authorization", () => {
  beforeEach(() => {
    axiosState.capturedConfigs.length = 0;
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it("attaches guest token to search calls", async () => {
    useAuthStore.setState({
      status: "authenticated",
      accessToken: "guest-token",
      expiresAt: Date.now() + 60_000,
      user: { role: "guest", id: "guest-123" },
      refreshCsrf: undefined,
    });

  await submitSearchJob("laptops");

    expect(axiosState.capturedConfigs).toHaveLength(1);
    const config = axiosState.capturedConfigs[0] as { headers: Record<string, string>; params?: Record<string, string> };
    expect(config.headers.Authorization).toBe("Bearer guest-token");
    expect(config.params).toEqual({ query: "laptops" });
  });
});
