type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'];

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel) return;
  const line: Record<string, unknown> = { ts: new Date().toISOString(), level, msg, ...extra };
  for (const k of Object.keys(line)) {
    if (/token|secret|password|key/i.test(k) && typeof line[k] === 'string') line[k] = '[REDACTED]';
  }
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

export const logger = {
  debug: (m: string, e?: Record<string, unknown>) => emit('debug', m, e),
  info:  (m: string, e?: Record<string, unknown>) => emit('info',  m, e),
  warn:  (m: string, e?: Record<string, unknown>) => emit('warn',  m, e),
  error: (m: string, e?: Record<string, unknown>) => emit('error', m, e),
};
