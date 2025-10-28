import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  computeCsrfToken,
  getRefreshSession,
  hashRefreshId,
  isRefreshHashRevoked,
  revokeRefreshHash,
} from "@/lib/server/refresh-store";
import type { RefreshSessionRecord } from "@/lib/server/refresh-store";
import { GET as sessionGet } from "../[...nextauth]/route";

const REFRESH_COOKIE_NAME = "__Host-rag-refresh";
const CSRF_HEADER_NAME = "x-refresh-csrf";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: true,
  path: "/",
};

const timingSafeEqual = (a: string, b: string) => {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
};

const validateRefreshRecord = async (hash: string): Promise<RefreshSessionRecord> => {
  if (await isRefreshHashRevoked(hash)) {
    throw new Error("revoked");
  }

  const record = await getRefreshSession(hash);
  if (!record) {
    throw new Error("missing");
  }

  if (record.expiresAt * 1000 < Date.now()) {
    await revokeRefreshHash(hash);
    throw new Error("expired");
  }

  return record;
};

export const POST = async (request: NextRequest) => {
  const csrfToken = request.headers.get(CSRF_HEADER_NAME);
  if (!csrfToken) {
    const response = NextResponse.json({ error: "Missing CSRF token" }, { status: 403 });
    response.cookies.set(REFRESH_COOKIE_NAME, "", { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  }

  const refreshCookie = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  if (!refreshCookie) {
    const response = NextResponse.json({ error: "Missing refresh cookie" }, { status: 401 });
    response.cookies.set(REFRESH_COOKIE_NAME, "", { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  }

  const expectedCsrf = computeCsrfToken(refreshCookie);
  if (!timingSafeEqual(csrfToken, expectedCsrf)) {
    const response = NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
    response.cookies.set(REFRESH_COOKIE_NAME, "", { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  }

  const refreshHash = hashRefreshId(refreshCookie);
  try {
    await validateRefreshRecord(refreshHash);
  } catch (error) {
    const response = NextResponse.json({ error: "Refresh session invalid" }, { status: 401 });
    response.cookies.set(REFRESH_COOKIE_NAME, "", { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  }

  const sessionUrl = new URL(request.url);
  sessionUrl.pathname = "/api/auth/session";

  const headers = new Headers(request.headers);
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  headers.set("accept", "application/json");

  const sessionRequest = new NextRequest(sessionUrl, {
    headers,
  });

  return sessionGet(sessionRequest);
};
