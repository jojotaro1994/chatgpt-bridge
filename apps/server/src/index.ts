import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { logger } from './logger.js';
import { httpHandler } from './http.js';
import { attachWs } from './ws.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

// Generate ephemeral dev tokens if not provided. NEVER log these.
if (!process.env.ADMIN_TOKEN) {
  process.env.ADMIN_TOKEN = randomBytes(24).toString('base64url');
  logger.warn('ADMIN_TOKEN not set; generated ephemeral token for this boot');
}
if (!process.env.RUNNER_PAIRING_TOKEN) {
  process.env.RUNNER_PAIRING_TOKEN = randomBytes(24).toString('base64url');
  logger.warn('RUNNER_PAIRING_TOKEN not set; generated ephemeral token for this boot');
}

const server = createServer(httpHandler);
attachWs(server);

server.listen(PORT, HOST, () => {
  logger.info('e2e-bridge server listening', {
    host: HOST,
    port: PORT,
    // We surface the *length* of the token only, never the value.
    admin_token_chars: process.env.ADMIN_TOKEN!.length,
    runner_pairing_token_chars: process.env.RUNNER_PAIRING_TOKEN!.length,
  });
});

function shutdown(sig: string): void {
  logger.info('shutting down', { signal: sig });
  server.close((err) => {
    if (err) {
      logger.error('close error', { err: String(err) });
      process.exit(1);
    }
    process.exit(0);
  });
  // Force-exit after 5s if connections linger
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection', { err: String(err) });
});
