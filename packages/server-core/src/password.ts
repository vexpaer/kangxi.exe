import type { SqlDatabase } from "./types.js";

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 60_000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const saltBuf = new Uint8Array(salt);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuf,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_BITS
  );
  return new Uint8Array(derived);
}

/**
 * Hashes a password with Web Crypto PBKDF2-SHA256 (zero native deps; works identically
 * on Cloudflare Workers and Node 22+/24).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  if (!storedHash) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 1_000_000) {
    return false;
  }
  try {
    const salt = fromBase64Url(parts[2]!);
    const expected = fromBase64Url(parts[3]!);
    const actual = await derivePbkdf2(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function extractClientIp(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf.trim();
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const realIp = request.headers.get("X-Real-IP");
  if (realIp) return realIp.trim();
  return "unknown";
}

export async function checkLoginRateLimit(
  db: SqlDatabase,
  key: string
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const row = await db
    .prepare(`SELECT failures, locked_until FROM login_attempts WHERE key = ?`)
    .bind(key)
    .first<{ failures: number; locked_until: string | null }>();

  if (!row?.locked_until) return { allowed: true };
  const lockUntilMs = Date.parse(row.locked_until);
  if (Number.isFinite(lockUntilMs) && lockUntilMs > Date.now()) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((lockUntilMs - Date.now()) / 1000)),
    };
  }
  return { allowed: true };
}

export async function recordLoginFailure(
  db: SqlDatabase,
  key: string
): Promise<{ locked: boolean; remaining: number }> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(`SELECT failures, locked_until FROM login_attempts WHERE key = ?`)
    .bind(key)
    .first<{ failures: number; locked_until: string | null }>();

  let failures = 1;
  if (row) {
    const expired = row.locked_until && Date.parse(row.locked_until) <= Date.now();
    failures = expired ? 1 : Number(row.failures ?? 0) + 1;
  }

  const locked = failures >= MAX_LOGIN_FAILURES;
  const lockedUntil = locked ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;

  await db
    .prepare(
      `INSERT INTO login_attempts (key, failures, locked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         failures = excluded.failures,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`
    )
    .bind(key, failures, lockedUntil, now)
    .run();

  return {
    locked,
    remaining: Math.max(0, MAX_LOGIN_FAILURES - failures),
  };
}

export async function clearLoginFailures(db: SqlDatabase, key: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(key).run();
}
