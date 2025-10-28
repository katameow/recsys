import crypto from "crypto";
import { kv } from "@vercel/kv";

export type RefreshRole = "guest" | "user" | "admin";

export interface RefreshSessionRecord {
  userId: string;
  role: RefreshRole;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  version: number;
}

interface RegisterRefreshParams extends RefreshSessionRecord {
  refreshId: string;
  previousRefreshHash?: string | null;
  ttlSeconds?: number;
}

interface RefreshStorageAdapter {
  persist(hash: string, record: RefreshSessionRecord, ttlSeconds: number): Promise<void>;
  revoke(hash: string, ttlSeconds: number): Promise<void>;
  get(hash: string): Promise<RefreshSessionRecord | null>;
  isRevoked(hash: string): Promise<boolean>;
}

const REFRESH_SESSION_PREFIX = "auth:refresh:session:";
const REFRESH_BLACKLIST_PREFIX = "auth:refresh:blacklist:";
export const DEFAULT_REFRESH_TTL_SECONDS = Number(process.env.REFRESH_SESSION_TTL ?? 60 * 60 * 24 * 7);
export const DEFAULT_BLACKLIST_TTL_SECONDS = Number(process.env.REFRESH_BLACKLIST_TTL ?? 60 * 60 * 24 * 2);

const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

type KvClient = typeof kv;

class UpstashAdapter implements RefreshStorageAdapter {
  private kv: KvClient;

  constructor(kvClient: KvClient) {
    this.kv = kvClient;
  }

  async persist(hash: string, record: RefreshSessionRecord, ttlSeconds: number): Promise<void> {
    await this.kv.set(`${REFRESH_SESSION_PREFIX}${hash}`, record, { ex: ttlSeconds });
  }

  async revoke(hash: string, ttlSeconds: number): Promise<void> {
    await this.kv.set(`${REFRESH_BLACKLIST_PREFIX}${hash}`, true, { ex: ttlSeconds });
  }

  async get(hash: string): Promise<RefreshSessionRecord | null> {
    const data = await this.kv.get<RefreshSessionRecord | null>(`${REFRESH_SESSION_PREFIX}${hash}`);
    return data ?? null;
  }

  async isRevoked(hash: string): Promise<boolean> {
    const data = await this.kv.get<boolean | null>(`${REFRESH_BLACKLIST_PREFIX}${hash}`);
    return Boolean(data);
  }
}

class InMemoryAdapter implements RefreshStorageAdapter {
  private sessions = new Map<string, { record: RefreshSessionRecord; expiresAt: number }>();
  private blacklist = new Map<string, number>();

  async persist(hash: string, record: RefreshSessionRecord, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.sessions.set(hash, { record, expiresAt });
  }

  async revoke(hash: string, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.blacklist.set(hash, expiresAt);
  }

  async get(hash: string): Promise<RefreshSessionRecord | null> {
    const entry = this.sessions.get(hash);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(hash);
      return null;
    }
    return entry.record;
  }

  async isRevoked(hash: string): Promise<boolean> {
    const expiresAt = this.blacklist.get(hash);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.blacklist.delete(hash);
      return false;
    }
    return true;
  }
}

const globalScope = globalThis as typeof globalThis & {
  __refreshStoreAdapter?: RefreshStorageAdapter;
};

const adapter: RefreshStorageAdapter = (() => {
  if (globalScope.__refreshStoreAdapter) {
    return globalScope.__refreshStoreAdapter;
  }

  const selectedAdapter: RefreshStorageAdapter = hasKv ? new UpstashAdapter(kv) : new InMemoryAdapter();
  globalScope.__refreshStoreAdapter = selectedAdapter;
  return selectedAdapter;
})();

export const hashRefreshId = (refreshId: string): string => {
  return crypto.createHash("sha256").update(refreshId).digest("hex");
};

export const computeCsrfToken = (refreshId: string): string => {
  const secret = process.env.REFRESH_CSRF_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("Missing REFRESH_CSRF_SECRET or NEXTAUTH_SECRET for CSRF token computation");
  }
  return crypto.createHmac("sha256", secret).update(refreshId).digest("base64url");
};

export const generateRefreshId = (): string => {
  return crypto.randomBytes(32).toString("base64url");
};

export async function registerRefreshSession(params: RegisterRefreshParams): Promise<{ hash: string; csrfToken: string }> {
  const {
    refreshId,
    userId,
    role,
    sessionId,
    issuedAt,
    expiresAt,
    version,
    previousRefreshHash,
    ttlSeconds,
  } = params;

  const hash = hashRefreshId(refreshId);
  const ttl = ttlSeconds ?? DEFAULT_REFRESH_TTL_SECONDS;

  await adapter.persist(hash, { userId, role, sessionId, issuedAt, expiresAt, version }, ttl);

  if (previousRefreshHash) {
    await adapter.revoke(previousRefreshHash, DEFAULT_BLACKLIST_TTL_SECONDS);
  }

  return { hash, csrfToken: computeCsrfToken(refreshId) };
}

export async function revokeRefreshHash(refreshHash: string, ttlSeconds?: number): Promise<void> {
  const ttl = ttlSeconds ?? DEFAULT_BLACKLIST_TTL_SECONDS;
  await adapter.revoke(refreshHash, ttl);
}

export async function isRefreshHashRevoked(refreshHash: string): Promise<boolean> {
  return adapter.isRevoked(refreshHash);
}

export async function getRefreshSession(refreshHash: string): Promise<RefreshSessionRecord | null> {
  return adapter.get(refreshHash);
}
