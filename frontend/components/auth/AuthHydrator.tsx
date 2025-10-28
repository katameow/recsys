"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useAuthStore } from "@/lib/auth-store";

type SessionPayload = {
  accessToken?: string;
  expires?: string | number;
  expiresAt?: number;
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    role?: "guest" | "user" | "admin";
  } | null;
  error?: "RefreshTokenError" | string;
  security?: {
    refreshCsrf?: string;
  } | null;
};

const toHydratable = (session: SessionPayload | null | undefined) => {
  if (!session) {
    return null;
  }

  const { accessToken, expiresAt, expires, user, security } = session;
  const refreshCsrf = security?.refreshCsrf;
  return {
    accessToken,
    expiresAt: typeof expiresAt === "number" ? expiresAt : expires,
    expires,
    user: user
      ? {
          id: user.id,
          email: user.email ?? undefined,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          role: user.role ?? "user",
        }
      : undefined,
    security: refreshCsrf ? { refreshCsrf } : undefined,
  };
};

const shallowEqual = (prev: ReturnType<typeof toHydratable>, next: ReturnType<typeof toHydratable>) => {
  if (prev === next) return true;
  if (!prev || !next) return false;
  return (
    prev.accessToken === next.accessToken &&
    prev.expiresAt === next.expiresAt &&
    prev.user?.id === next.user?.id &&
    prev.user?.email === next.user?.email &&
    prev.user?.role === next.user?.role &&
    prev.security?.refreshCsrf === next.security?.refreshCsrf
  );
};

export function AuthHydrator() {
  const { data: session, status } = useSession();
  const hydrateFromSession = useAuthStore((state) => state.hydrateFromSession);
  const setLoading = useAuthStore((state) => state.setLoading);
  const logout = useAuthStore((state) => state.logout);
  const previous = useRef<ReturnType<typeof toHydratable>>(null);

  useEffect(() => {
    if (status === "loading") {
      setLoading(true);
      return;
    }

    setLoading(false);

    if (status === "unauthenticated") {
      previous.current = null;
      hydrateFromSession(null);
      return;
    }

    if (session?.error === "RefreshTokenError") {
      previous.current = null;
      logout();
      return;
    }

    if (status === "authenticated") {
      const normalized = toHydratable(session as SessionPayload);
      if (!shallowEqual(previous.current, normalized)) {
        previous.current = normalized;
        hydrateFromSession(
          normalized
            ? {
                user: normalized.user,
                accessToken: normalized.accessToken,
                expiresAt: normalized.expiresAt,
                expires: normalized.expires,
                security: normalized.security,
              }
            : null
        );
      }
    }
  }, [status, session, hydrateFromSession, setLoading, logout]);

  return null;
}
