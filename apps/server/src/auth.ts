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
