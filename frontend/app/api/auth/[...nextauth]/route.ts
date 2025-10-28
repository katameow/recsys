import crypto from "crypto";
import NextAuth, { type NextAuthConfig } from "next-auth";
import type { JWT as NextAuthJWT } from "next-auth/jwt";
import { getToken } from "next-auth/jwt";
import Google from "next-auth/providers/google";
import Github from "next-auth/providers/github";
import AzureAD from "next-auth/providers/azure-ad";
import { SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_REFRESH_TTL_SECONDS,
  generateRefreshId,
  registerRefreshSession,
} from "@/lib/server/refresh-store";

const ADMIN_AUDIENCE = "rag-recommender";
const adminEmailSet = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

const providers = [
  ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          authorization: {
            params: {
              access_type: "offline",
              prompt: "consent",
              response_type: "code",
            },
          },
        }),
      ]
    : []),
  ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
    ? [
        Github({
          clientId: process.env.AUTH_GITHUB_ID,
          clientSecret: process.env.AUTH_GITHUB_SECRET,
        }),
      ]
    : []),
  ...(process.env.AUTH_AZURE_AD_CLIENT_ID &&
  process.env.AUTH_AZURE_AD_CLIENT_SECRET &&
  process.env.AUTH_AZURE_AD_TENANT_ID
    ? [
        AzureAD({
          clientId: process.env.AUTH_AZURE_AD_CLIENT_ID,
          clientSecret: process.env.AUTH_AZURE_AD_CLIENT_SECRET,
          issuer: `https://login.microsoftonline.com/${process.env.AUTH_AZURE_AD_TENANT_ID}/v2.0`,
          authorization: {
            params: {
              scope: "openid profile email offline_access",
            },
          },
        }),
      ]
    : []),
];

type AppUserRole = "guest" | "user" | "admin";

type AugmentedToken = NextAuthJWT & {
  role?: AppUserRole;
  providerAccessToken?: string;
  aud?: string;
  refresh_token?: string;
  expires_at?: number;
  error?: "RefreshTokenError";
  provider?: string;
  sessionId?: string;
  refreshSessionId?: string;
  refreshHash?: string;
  refreshVersion?: number;
  refreshExpiresAt?: number;
  refreshCsrf?: string;
  appAccessToken?: string;
  appAccessTokenExpiresAt?: number;
} & Record<string, unknown>;

// Module augmentation for NextAuth types
declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role: AppUserRole;
    };
    accessToken?: string;
    error?: "RefreshTokenError";
    expiresAt?: number;
    refresh?: {
      expiresAt?: number;
    };
    security?: {
      refreshCsrf: string;
    };
  }
  
  interface User {
    role: AppUserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppUserRole;
    providerAccessToken?: string;
    aud?: string;
    refresh_token?: string;
    expires_at?: number;
    error?: "RefreshTokenError";
    provider?: string;
    sessionId?: string;
    refreshSessionId?: string;
    refreshHash?: string;
    refreshVersion?: number;
    refreshExpiresAt?: number;
    refreshCsrf?: string;
    appAccessToken?: string;
    appAccessTokenExpiresAt?: number;
  }
}

const toEpochSeconds = (value?: number | null): number | undefined => {
  if (value == null) return undefined;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed > 1_000_000_000_000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
};

const OAUTH_TOKEN_ENDPOINTS: Record<string, () => { url: string; body: URLSearchParams }> = {
  google: () => {
    if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
      throw new Error("Missing Google client configuration");
    }

    return {
      url: "https://oauth2.googleapis.com/token",
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID,
        client_secret: process.env.AUTH_GOOGLE_SECRET,
        grant_type: "refresh_token",
      }),
    };
  },
  "azure-ad": () => {
    if (
      !process.env.AUTH_AZURE_AD_CLIENT_ID ||
      !process.env.AUTH_AZURE_AD_CLIENT_SECRET ||
      !process.env.AUTH_AZURE_AD_TENANT_ID
    ) {
      throw new Error("Missing Azure AD client configuration");
    }

    return {
      url: `https://login.microsoftonline.com/${process.env.AUTH_AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
      body: new URLSearchParams({
        client_id: process.env.AUTH_AZURE_AD_CLIENT_ID,
        client_secret: process.env.AUTH_AZURE_AD_CLIENT_SECRET,
        grant_type: "refresh_token",
        scope: "openid profile email offline_access",
      }),
    };
  },
  github: () => {
    if (!process.env.AUTH_GITHUB_ID || !process.env.AUTH_GITHUB_SECRET) {
      throw new Error("Missing GitHub client configuration");
    }

    return {
      url: "https://github.com/login/oauth/access_token",
      body: new URLSearchParams({
        client_id: process.env.AUTH_GITHUB_ID,
        client_secret: process.env.AUTH_GITHUB_SECRET,
        grant_type: "refresh_token",
      }),
    };
  },
};

const REFRESH_COOKIE_NAME = "__Host-rag-refresh";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: true,
  path: "/",
};

const globalStore = globalThis as typeof globalThis & {
  __pendingRefreshSessions?: Map<string, { id: string; expiresAt: number }>;
};

const pendingRefreshSessions = globalStore.__pendingRefreshSessions ?? (() => {
  const map = new Map<string, { id: string; expiresAt: number }>();
  globalStore.__pendingRefreshSessions = map;
  return map;
})();

const APP_JWT_ISSUER = process.env.APP_JWT_ISSUER ?? "rag-recommender";
const APP_JWT_AUDIENCE = process.env.APP_JWT_AUDIENCE ?? ADMIN_AUDIENCE;
const APP_ACCESS_TOKEN_TTL_SECONDS = Number(process.env.APP_ACCESS_TOKEN_TTL ?? 60 * 5);
const APP_JWT_SECRET = process.env.APP_JWT_SECRET ?? process.env.NEXTAUTH_SECRET;

if (!APP_JWT_SECRET) {
  throw new Error("Missing APP_JWT_SECRET or NEXTAUTH_SECRET for signing application tokens");
}

const APP_JWT_SECRET_BUFFER = new TextEncoder().encode(APP_JWT_SECRET);

const computeSubject = (token: AugmentedToken): string => {
  return (
    token.sub ||
    (typeof token.email === "string" ? token.email : undefined) ||
    token.sessionId ||
    token.refreshHash ||
    crypto.randomUUID()
  );
};

const ensureSessionId = (token: AugmentedToken) => {
  if (!token.sessionId) {
    token.sessionId = crypto.randomUUID();
  }
};

const ensureRole = (token: AugmentedToken, email?: string | null) => {
  if (!token.role) {
    token.role = resolveRole(email);
  }
};

const ensureRefreshSessionId = (token: AugmentedToken) => {
  if (!token.refreshSessionId) {
    token.refreshSessionId = generateRefreshId();
  }
};

const syncRefreshSession = async (
  token: AugmentedToken,
  { rotate }: { rotate: boolean }
) => {
  ensureSessionId(token);
  ensureRefreshSessionId(token);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = nowSeconds + DEFAULT_REFRESH_TTL_SECONDS;
  const previousHash = rotate ? token.refreshHash : undefined;

  const { hash, csrfToken } = await registerRefreshSession({
    refreshId: token.refreshSessionId!,
    userId: computeSubject(token),
    role: token.role ?? "user",
    sessionId: token.sessionId!,
    issuedAt: nowSeconds,
    expiresAt: expiresAtSeconds,
    version: (token.refreshVersion ?? 0) + 1,
    previousRefreshHash: previousHash,
  });

  token.refreshHash = hash;
  token.refreshCsrf = csrfToken;
  token.refreshVersion = (token.refreshVersion ?? 0) + 1;
  token.refreshExpiresAt = expiresAtSeconds * 1000;

  if (token.sessionId) {
    pendingRefreshSessions.set(token.sessionId, {
      id: token.refreshSessionId!,
      expiresAt: token.refreshExpiresAt,
    });
  }
};

const signAppAccessToken = async (token: AugmentedToken) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + APP_ACCESS_TOKEN_TTL_SECONDS;

  const payload = {
    role: token.role ?? "user",
    rid: token.refreshHash,
    sid: token.sessionId,
    email: token.email,
    aud: APP_JWT_AUDIENCE,
  };

  const signed = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(APP_JWT_ISSUER)
    .setAudience(APP_JWT_AUDIENCE)
    .setSubject(computeSubject(token))
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAt)
    .sign(APP_JWT_SECRET_BUFFER);

  token.appAccessToken = signed;
  token.appAccessTokenExpiresAt = expiresAt;
};

const ensureAppAccessToken = async (token: AugmentedToken, force: boolean) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isExpired =
    typeof token.appAccessTokenExpiresAt !== "number" ||
    nowSeconds >= token.appAccessTokenExpiresAt - 10;

  if (force || isExpired) {
    await signAppAccessToken(token);
  }
};

const refreshOAuthToken = async (token: AugmentedToken): Promise<AugmentedToken> => {
  if (!token.refresh_token || !token.provider) {
    throw new Error("Missing refresh token details");
  }

  const endpointResolver = OAUTH_TOKEN_ENDPOINTS[token.provider];
  if (!endpointResolver) {
    throw new Error(`Unsupported provider for refresh: ${token.provider}`);
  }

  const { url, body } = endpointResolver();
  body.set("refresh_token", token.refresh_token);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const tokens = await response.json();

  if (!response.ok) {
    throw tokens;
  }

  const expiresIn =
    typeof tokens.expires_in === "number"
      ? tokens.expires_in
      : typeof tokens.expires_in === "string"
      ? Number(tokens.expires_in)
      : undefined;

  return {
    ...token,
    providerAccessToken: tokens.access_token ?? token.providerAccessToken,
    expires_at: expiresIn ? Math.floor(Date.now() / 1000 + expiresIn) : token.expires_at,
    refresh_token: tokens.refresh_token ?? tokens.refreshToken ?? token.refresh_token,
    error: undefined,
  };
};

const resolveRole = (email?: string | null): AppUserRole => {
  if (!email) return "user";
  const normalized = email.toLowerCase();
  if (adminEmailSet.has(normalized)) {
    return "admin";
  }
  return "user";
};

const authConfig: NextAuthConfig = {
  session: {
    strategy: "jwt",
    maxAge: 60 * 15,
  },
  jwt: {
    maxAge: 60 * 15,
  },
  providers,
  callbacks: {
    async jwt({ token, account, profile }) {
      const nextToken = token as AugmentedToken;
      let rotateRefresh = false;

      if (account) {
        const email = (profile?.email as string | undefined) ?? (nextToken.email as string | undefined);

        ensureRole(nextToken, email);
        nextToken.aud = ADMIN_AUDIENCE;
        nextToken.provider = account.provider;

        if (account.access_token) {
          nextToken.providerAccessToken = account.access_token;
        }
        if (account.refresh_token) {
          nextToken.refresh_token = account.refresh_token;
        }

        const expiresAtSeconds =
          account.expires_at ??
          (typeof account.expires_in === "number"
            ? Math.floor(Date.now() / 1000 + account.expires_in)
            : undefined);

        if (expiresAtSeconds) {
          nextToken.expires_at = toEpochSeconds(expiresAtSeconds);
        }

        nextToken.refreshSessionId = generateRefreshId();
        nextToken.refreshVersion = 0;
        rotateRefresh = true;
      } else {
        ensureRole(nextToken, nextToken.email as string | undefined);
      }

      const expirationBufferSeconds = 30;
      const shouldAttemptRefresh =
        typeof nextToken.expires_at === "number" &&
        Date.now() / 1000 > nextToken.expires_at - expirationBufferSeconds;

      if (shouldAttemptRefresh) {
        try {
          const refreshed = await refreshOAuthToken(nextToken);
          nextToken.providerAccessToken = refreshed.providerAccessToken;
          nextToken.expires_at = refreshed.expires_at;
          nextToken.refresh_token = refreshed.refresh_token;
          nextToken.error = undefined;
          nextToken.refreshSessionId = generateRefreshId();
          rotateRefresh = true;
        } catch (error) {
          console.error("Error refreshing access token", error);
          nextToken.error = "RefreshTokenError";
          nextToken.providerAccessToken = undefined;
          nextToken.expires_at = undefined;
        }
      }

      ensureSessionId(nextToken);
      ensureRefreshSessionId(nextToken);

      const needsSync = rotateRefresh || !nextToken.refreshHash || !nextToken.refreshCsrf;
      if (needsSync) {
        await syncRefreshSession(nextToken, { rotate: rotateRefresh });
      }

      await ensureAppAccessToken(nextToken, rotateRefresh);

      return nextToken;
    },
    async session({ session, token }) {
      const nextToken = token as AugmentedToken;

      const role = nextToken.role ?? "user";
      const userWithRole = session.user ? { ...session.user, role } : { role };

      const refreshMetadata = nextToken.refreshExpiresAt
        ? { expiresAt: nextToken.refreshExpiresAt }
        : null;

      const security = nextToken.refreshCsrf
        ? { refreshCsrf: nextToken.refreshCsrf }
        : null;

      return {
        ...session,
        user: userWithRole,
        accessToken: nextToken.appAccessToken,
        expiresAt: nextToken.appAccessTokenExpiresAt
          ? nextToken.appAccessTokenExpiresAt * 1000
          : undefined,
        ...(refreshMetadata ? { refresh: refreshMetadata } : {}),
        ...(security ? { security } : {}),
        error: nextToken.error,
      };
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
};

if (!providers.length) {
  console.warn(
    "No OAuth providers configured for next-auth. Add environment variables to enable login."
  );
}

const { handlers, auth } = NextAuth(authConfig);
const applyRefreshCookie = async (request: NextRequest, response: Response) => {
  const token = (await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET ?? APP_JWT_SECRET,
  })) as AugmentedToken | null;

  const nextResponse = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });

  const sessionId = (token?.sessionId as string | undefined) ?? undefined;
  const pending = sessionId ? pendingRefreshSessions.get(sessionId) : undefined;
  const refreshId = pending?.id ?? token?.refreshSessionId;
  const expiresMs = pending?.expiresAt ?? token?.refreshExpiresAt ?? Date.now() + DEFAULT_REFRESH_TTL_SECONDS * 1000;

  if (sessionId && pending) {
    pendingRefreshSessions.delete(sessionId);
  }

  if (refreshId) {
    const maxAge = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));

    nextResponse.cookies.set(REFRESH_COOKIE_NAME, refreshId, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge,
    });
  } else {
    nextResponse.cookies.set(REFRESH_COOKIE_NAME, "", {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: 0,
    });
  }

  return nextResponse;
};

export const GET = async (request: NextRequest) => {
  const response = await handlers.GET(request);
  return applyRefreshCookie(request, response);
};

export const POST = async (request: NextRequest) => {
  const response = await handlers.POST(request);
  return applyRefreshCookie(request, response);
};

export { auth };
