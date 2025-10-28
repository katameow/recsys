import axios, { AxiosError, AxiosRequestConfig } from "axios";
import type { SearchAcceptedResponse, SearchResultEnvelope } from "@/types";
import { useAuthStore, type AuthUser } from "../lib/auth-store";
import {
  parseApiError,
  handleAuthError,
  retryWithAuth,
  createAuthError,
  type AuthError,
} from "../lib/auth-errors";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const REFRESH_ENDPOINT = "/api/auth/refresh";
const REFRESH_CSRF_HEADER = "x-refresh-csrf";

interface SessionResponse {
  user?: Partial<AuthUser> & { role?: AuthUser["role"] };
  accessToken?: string;
  expires?: string;
  expiresAt?: number;
  refresh?: { expiresAt?: number };
  security?: { refreshCsrf?: string };
  error?: "RefreshTokenError";
}

type RefreshableAxiosRequestConfig = AxiosRequestConfig & { _retry?: boolean };

const REFRESH_BUFFER_MS = 15_000; // 15 seconds buffer before expiry

let refreshPromise: Promise<void> | null = null;

const computeExpiresAt = (session: SessionResponse): number | undefined => {
  if (typeof session.expiresAt === "number") {
    return session.expiresAt;
  }

  if (session.expires) {
    const parsed = Date.parse(session.expires);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
};

const finalizeAuthFailure = async (error: AuthError) => {
  if (error.type === "RefreshTokenError" || error.type === "AccessDenied") {
    useAuthStore.getState().logout();
  }

  await handleAuthError(error);
};

const requestRefreshSession = async (csrfToken: string): Promise<SessionResponse> => {
  const response = await fetch(REFRESH_ENDPOINT, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      [REFRESH_CSRF_HEADER]: csrfToken,
    },
  });

  if (response.status === 401) {
    throw createAuthError("RefreshTokenError", "Session expired", undefined, {
      status: 401,
    });
  }

  if (response.status === 403) {
    throw createAuthError("RefreshTokenError", "Refresh CSRF validation failed", undefined, {
      status: 403,
    });
  }

  if (!response.ok) {
    throw createAuthError(
      "NetworkError",
      `Unable to refresh session (${response.status})`,
      String(response.status),
      { status: response.status }
    );
  }

  try {
    const data = (await response.json()) as SessionResponse;
    return data;
  } catch (error) {
    throw createAuthError("NetworkError", "Invalid session payload", undefined, error);
  }
};

const refreshAccessToken = async () => {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const authStore = useAuthStore.getState();

    if (authStore.status !== "authenticated" || authStore.user?.role === "guest") {
      throw createAuthError("RefreshTokenError", "No refresh flow available for current session");
    }

    const csrfToken = authStore.refreshCsrf;

    if (!csrfToken) {
      throw createAuthError("RefreshTokenError", "Missing refresh token metadata");
    }

    const session = await requestRefreshSession(csrfToken);

    if (session.error === "RefreshTokenError") {
      throw createAuthError("RefreshTokenError", "Session refresh rejected", undefined, session);
    }

    if (!session.accessToken) {
      throw createAuthError("RefreshTokenError", "No access token returned from session", undefined, session);
    }

    const normalizedUser: AuthUser | undefined = session.user
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          image: session.user.image,
          role: session.user.role ?? "user",
        }
      : undefined;

    authStore.hydrateFromSession({
      user: normalizedUser,
      accessToken: session.accessToken,
      expiresAt: computeExpiresAt(session),
      security: session.security,
    });
  })()
    .catch((error) => {
      if (
        error &&
        typeof error === "object" &&
        "type" in (error as Record<string, unknown>) &&
        (error as AuthError).type === "RefreshTokenError"
      ) {
        useAuthStore.getState().logout();
      }

      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
};

// Create axios instance with auth interceptors
const createApiClient = () => {
  const client = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
  });

  // Request interceptor to add auth token
  client.interceptors.request.use(
    async (config) => {
      const authStore = useAuthStore.getState();

      authStore.checkAndAutoLogout();

      if (authStore.status === "authenticated") {
        const expiresAt = authStore.expiresAt;
        const isNearExpiry =
          typeof expiresAt === "number" && Date.now() + REFRESH_BUFFER_MS >= expiresAt;

        if (isNearExpiry && authStore.user?.role !== "guest") {
          try {
            await refreshAccessToken();
          } catch (error) {
            if (error && typeof error === "object" && "type" in (error as Record<string, unknown>)) {
              await finalizeAuthFailure(error as AuthError);
              throw error;
            }

            throw error;
          }
        }
      }

      const latestAuthState = useAuthStore.getState();

      if (latestAuthState.accessToken && latestAuthState.status === "authenticated") {
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>).Authorization = `Bearer ${latestAuthState.accessToken}`;
      }

      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor to handle auth errors
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const authError = parseApiError(error);
      const status = error.response?.status;

      if (status === 401 && error.config) {
        const authStore = useAuthStore.getState();
        const requestConfig = error.config as RefreshableAxiosRequestConfig;

        if (!requestConfig._retry && authStore.status === "authenticated" && authStore.user?.role !== "guest") {
          requestConfig._retry = true;

          try {
            await refreshAccessToken();
            const latestAuthState = useAuthStore.getState();

            if (latestAuthState.accessToken) {
              requestConfig.headers = requestConfig.headers ?? {};
              (requestConfig.headers as Record<string, string>).Authorization = `Bearer ${latestAuthState.accessToken}`;
            }

            return client(requestConfig);
          } catch (refreshError) {
            const refreshAuthError =
              refreshError && typeof refreshError === "object" && "type" in (refreshError as Record<string, unknown>)
                ? (refreshError as AuthError)
                : createAuthError("RefreshTokenError", "Unable to refresh session", undefined, refreshError);

            await finalizeAuthFailure(refreshAuthError);
            return Promise.reject(refreshAuthError);
          }
        }

        if (authStore.status !== "unauthenticated") {
          await finalizeAuthFailure(authError);
          return Promise.reject(authError);
        }
      }

      return Promise.reject(authError);
    }
  );

  return client;
};

const apiClient = createApiClient();

export const __testables = {
  requestRefreshSession,
};

export interface SubmitSearchOptions {
  queryHash?: string;
  productsK?: number;
  reviewsPerProduct?: number;
  bypassCache?: boolean;
}

const buildSearchPayload = (query: string, options: SubmitSearchOptions) => {
  const payload: Record<string, unknown> = { query };

  if (options.queryHash) {
    payload.query_hash = options.queryHash;
  }
  if (typeof options.productsK === "number") {
    payload.products_k = options.productsK;
  }
  if (typeof options.reviewsPerProduct === "number") {
    payload.reviews_per_product = options.reviewsPerProduct;
  }
  if (typeof options.bypassCache === "boolean") {
    payload.bypass_cache = options.bypassCache;
  }

  return payload;
};

export const submitSearchJob = async (
  query: string,
  options: SubmitSearchOptions = {}
): Promise<SearchAcceptedResponse> => {
  return retryWithAuth(async () => {
    try {
      const response = await apiClient.request<SearchAcceptedResponse>({
        url: "/search",
        method: "post",
        data: buildSearchPayload(query, options),
        params: { query },
      });
      return response.data;
    } catch (error) {
      throw parseApiError(error);
    }
  });
};

export const fetchSearchResult = async (queryHash: string): Promise<SearchResultEnvelope> => {
  return retryWithAuth(async () => {
    try {
      const response = await apiClient.request<SearchResultEnvelope>({
        url: `/search/result/${encodeURIComponent(queryHash)}`,
        method: "get",
      });
      return response.data;
    } catch (error) {
      throw parseApiError(error);
    }
  });
};

// Generic API call function with auth handling
export const makeAuthenticatedRequest = async <T>(
  config: AxiosRequestConfig
): Promise<T> => {
  return retryWithAuth(async () => {
    const response = await apiClient.request<T>(config);
    return response.data;
  });
};

// Guest API calls (no auth required)
export const makeGuestRequest = async <T>(
  config: AxiosRequestConfig
): Promise<T> => {
  try {
    const response = await axios.request<T>({
      ...config,
      baseURL: API_BASE_URL,
      timeout: 30000,
    });
    return response.data;
  } catch (error) {
    const authError = parseApiError(error);
    throw authError;
  }
};

// Admin-only API calls
export const makeAdminRequest = async <T>(
  config: AxiosRequestConfig
): Promise<T> => {
  const authStore = useAuthStore.getState();
  
  if (authStore.user?.role !== "admin") {
    throw parseApiError({ status: 403, message: "Admin access required" });
  }
  
  return makeAuthenticatedRequest<T>(config);
};