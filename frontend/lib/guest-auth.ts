import { makeGuestRequest } from "@/utils/api";
import type { AuthUser } from "@/lib/auth-store";
import { createAuthError, parseApiError } from "@/lib/auth-errors";

type GuestResponseUser = Partial<AuthUser> & { role?: AuthUser["role"] };

type GuestTokenResponse = {
  accessToken?: string;
  access_token?: string;
  token?: string;
  expiresAt?: number;
  expires_at?: number;
  expiresIn?: number;
  expires_in?: number;
  user?: GuestResponseUser;
};

const toEpochMilliseconds = (input?: number | string | null) => {
  if (input == null) return undefined;
  const value = typeof input === "string" ? Number(input) : input;
  if (!Number.isFinite(value)) return undefined;
  return value > 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
};

export interface GuestSession {
  accessToken: string;
  expiresAt?: number;
  user: AuthUser;
}

export const requestGuestSession = async (): Promise<GuestSession> => {
  try {
    const response = await makeGuestRequest<GuestTokenResponse>({
      url: "/auth/guest",
      method: "POST",
    });

    const accessToken = response.accessToken ?? response.access_token ?? response.token;

    if (!accessToken) {
      throw createAuthError("ValidationError", "Guest endpoint did not return an access token");
    }

    const expiresAt =
      toEpochMilliseconds(response.expiresAt ?? response.expires_at) ??
      (response.expiresIn ?? response.expires_in
        ? Date.now() + Number(response.expiresIn ?? response.expires_in) * 1000
        : undefined);

    const user: AuthUser = {
      id: response.user?.id,
      email: response.user?.email,
      name: response.user?.name,
      image: response.user?.image,
      role: response.user?.role ?? "guest",
    };

    return { accessToken, expiresAt, user };
  } catch (error) {
    if (error && typeof error === "object" && "type" in (error as Record<string, unknown>)) {
      throw error;
    }
    throw parseApiError(error);
  }
};
