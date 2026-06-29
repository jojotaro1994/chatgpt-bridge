import { timingSafeEqual } from 'node:crypto';
import { logger } from './logger.js';

/**
 * Constant-time string compare. Returns false on length mismatch or error.
 */
export function safeEq(a: string, b: string): boolean {
  const A = Buffer.from(a, 'utf8');
  const B = Buffer.from(b, 'utf8');
  if (A.length !== B.length) return false;
  try {
    return timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

/**
 * Pull a bearer token from an HTTP Authorization header.
 */
export function bearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const h = headers['authorization'];
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return null;
  const m = /^Bearer\s+(.+)$/i.exec(v);
  return m ? m[1]! : null;
}

/**
 * Validate an HTTP request's admin token against the env-stored one.
 * The env value is loaded at boot; never logged.
 */
export function isValidAdminToken(presented: string | null, expected: string): boolean {
  if (!presented || !expected) return false;
  const ok = safeEq(presented, expected);
  if (!ok) logger.warn('admin token mismatch');
  return ok;
}

/**
 * Role of a presented bearer token. ADMIN = the single env-stored admin token
 * (used for pairing and privileged operations). DEVICE = a paired device token
 * (the most common case for normal use).
 */
export type TokenRole = 'admin' | 'device' | 'none';

export interface ResolvedToken {
  role: TokenRole;
  /** When role === 'device': the device id; otherwise undefined. */
  deviceId?: string;
}

/**
 * Resolve a presented bearer token to a role. Returns role='none' if neither
 * admin nor any active device token matches.
 */
export function resolveToken(
  presented: string | null,
  adminToken: string,
  store: import('./store.js').Store,
): ResolvedToken {
  if (!presented) return { role: 'none' };
  if (adminToken && safeEq(presented, adminToken)) return { role: 'admin' };
  const rec = store.getPairedByToken(presented);
  if (rec) return { role: 'device', deviceId: rec.id };
  return { role: 'none' };
}

/**
 * Validate a runner pairing token. Pairing tokens are single-use — once a runner
 * successfully pairs, we replace it with a fresh random. Until then, the same
 * token is accepted.
 */
const runnerPairingToken = process.env.RUNNER_PAIRING_TOKEN ?? '';

export function consumeRunnerPairingToken(presented: string | null): boolean {
  if (!presented || !runnerPairingToken) return false;
  return safeEq(presented, runnerPairingToken);
}

/** Random token helper (used to mint session/user tokens at boot). */
export function randomToken(bytes = 24): string {
  // dynamic import to avoid bundling crypto in test paths
  // (top-level import is also fine; this keeps the API symmetrical)
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  return randomBytes(bytes).toString('base64url');
}
