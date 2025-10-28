import { create } from "zustand";

export type AuthRole = "guest" | "user" | "admin";

// Helper function to normalize expiry time to epoch ms
const normalizeExpiry = (expiry?: string | number): number | undefined => {
  if (!expiry) return undefined;
  if (typeof expiry === "number") return expiry;
  // Parse ISO string to ms
  const timestamp = Date.parse(expiry);
  return isNaN(timestamp) ? undefined : timestamp;
};

// Helper function to check if token is expired
const isTokenExpired = (expiresAt?: number): boolean => {
  if (!expiresAt) return false;
  return Date.now() > expiresAt;
};

export interface AuthUser {
  id?: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  role: AuthRole;
}

interface SetTokenParams {
  accessToken?: string;
  expiresAt?: number | string; // Accept both epoch ms and ISO strings
}

interface LoginPayload extends SetTokenParams {
  user: AuthUser;
  refreshCsrf?: string;
}

interface AuthState {
  status: "unauthenticated" | "authenticated" | "loading";
  accessToken?: string;
  expiresAt?: number;
  user?: AuthUser;
  refreshCsrf?: string;
  login: (payload: LoginPayload) => void;
  logout: () => void;
  setAccessToken: (payload: SetTokenParams) => void;
  setLoading: (isLoading: boolean) => void;
  hydrateFromSession: (
    session: (Partial<LoginPayload> & {
      expires?: string | number;
      security?: { refreshCsrf?: string };
    }) | null | undefined
  ) => void;
  isExpired: () => boolean;
  checkAndAutoLogout: () => void;
}

const initialState: Pick<AuthState, "status" | "accessToken" | "expiresAt" | "user" | "refreshCsrf"> = {
  status: "unauthenticated",
  accessToken: undefined,
  expiresAt: undefined,
  user: undefined,
  refreshCsrf: undefined,
};

const ensureAuthenticated = (user?: AuthUser): "authenticated" | "unauthenticated" =>
  user ? "authenticated" : "unauthenticated";

export const useAuthStore = create<AuthState>((set, get) => ({
  ...initialState,
  login: ({ user, accessToken, expiresAt, refreshCsrf }) => {
    const normalizedExpiry = normalizeExpiry(expiresAt);
    const normalizedUser = user ? { ...user, role: user.role ?? "user" } : undefined;
    set({
      user: normalizedUser,
      accessToken,
      expiresAt: normalizedExpiry,
      refreshCsrf,
      status: ensureAuthenticated(normalizedUser),
    });
  },
  logout: () => {
    set(initialState);
  },
  setAccessToken: ({ accessToken, expiresAt }) => {
    const normalizedExpiry = normalizeExpiry(expiresAt);
    set((state) => ({
      accessToken: accessToken ?? state.accessToken,
      expiresAt: normalizedExpiry ?? state.expiresAt,
      status: ensureAuthenticated(state.user),
    }));
  },
  setLoading: (isLoading) => {
    const current = get();
    set({
      status: isLoading ? "loading" : ensureAuthenticated(current.user),
    });
  },
  hydrateFromSession: (session) => {
    if (!session?.user) {
      set(initialState);
      return;
    }

    const normalizedExpiry = normalizeExpiry(session.expiresAt ?? session.expires);
    const normalizedUser = session.user ? { ...session.user, role: session.user.role ?? "user" } : undefined;
    const refreshCsrf = session.security?.refreshCsrf ?? undefined;
    set({
      user: normalizedUser,
      accessToken: session.accessToken,
      expiresAt: normalizedExpiry,
      refreshCsrf,
      status: ensureAuthenticated(normalizedUser),
    });
  },
  isExpired: () => {
    const state = get();
    return isTokenExpired(state.expiresAt);
  },
  checkAndAutoLogout: () => {
    const state = get();
    if (state.status === "authenticated" && isTokenExpired(state.expiresAt)) {
      set(initialState);
    }
  },
}));
