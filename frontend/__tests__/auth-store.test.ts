import { beforeEach, describe, expect, it } from "vitest";

import { useAuthStore } from "../lib/auth-store";

describe("auth store hydration", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });

  it("hydrates refreshCsrf from session security metadata", () => {
    const store = useAuthStore.getState();
    const future = Date.now() + 60_000;

    store.hydrateFromSession({
      user: { role: "user" },
      accessToken: "access-token",
      expiresAt: future,
      security: { refreshCsrf: "csrf-token" },
    });

    const state = useAuthStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.refreshCsrf).toBe("csrf-token");
    expect(state.accessToken).toBe("access-token");
  });

  it("clears refreshCsrf when metadata is absent", () => {
    const store = useAuthStore.getState();
    const future = Date.now() + 60_000;

    store.hydrateFromSession({
      user: { role: "user" },
      accessToken: "access-token",
      expiresAt: future,
      security: { refreshCsrf: "csrf-token" },
    });

    store.hydrateFromSession({
      user: { role: "user" },
      accessToken: "next-token",
      expiresAt: future + 60_000,
    });

    const state = useAuthStore.getState();
    expect(state.refreshCsrf).toBeUndefined();
    expect(state.accessToken).toBe("next-token");
  });

  it("resets to initial state when session is null", () => {
    const store = useAuthStore.getState();
    const future = Date.now() + 60_000;

    store.hydrateFromSession({
      user: { role: "user" },
      accessToken: "access-token",
      expiresAt: future,
      security: { refreshCsrf: "csrf-token" },
    });

    store.hydrateFromSession(null);

    const state = useAuthStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.refreshCsrf).toBeUndefined();
    expect(state.accessToken).toBeUndefined();
  });
});
