import { randomBytes } from 'node:crypto';

export function newId(prefix?: string): string {
  const raw = randomBytes(12).toString('base64url'); // 16 chars
  return prefix ? `${prefix}_${raw}` : raw;
}

export function nowIso(): string {
  return new Date().toISOString();
}
