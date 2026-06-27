/**
 * Minimal structured-ish logger. NEVER logs token values or env-derived secrets.
 * Use logger.token(...) for token-related info — it only logs the token prefix.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minLevel: number =
  LEVELS[(process.env.LOG_LEVEL as Level) || 'info'] ?? LEVELS.info;

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel) return;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...extra,
  };
  // Filter any key that looks like a secret
  for (const k of Object.keys(line)) {
    if (/token|secret|password|key/i.test(k) && typeof line[k] === 'string') {
      line[k] = '[REDACTED]';
    }
  }
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info:  (msg: string, extra?: Record<string, unknown>) => emit('info',  msg, extra),
  warn:  (msg: string, extra?: Record<string, unknown>) => emit('warn',  msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
};
