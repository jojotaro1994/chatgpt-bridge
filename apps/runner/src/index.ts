import { RunnerClient } from './client.js';
import { buildAdapter } from './adapter-factory.js';
import { detectDeviceType } from './ids.js';
import { logger } from './logger.js';

const SERVER_URL = process.env.SERVER_URL ?? 'ws://127.0.0.1:3000/ws/runner';
const PAIRING_TOKEN = process.env.RUNNER_PAIRING_TOKEN ?? '';

if (!PAIRING_TOKEN) {
  logger.warn('RUNNER_PAIRING_TOKEN not set; server will reject pairing');
}

const adapter = buildAdapter();

const client = new RunnerClient({
  serverUrl: SERVER_URL,
  pairingToken: PAIRING_TOKEN,
  device: {
    name: process.env.RUNNER_NAME ?? `runner-${process.env.HOSTNAME ?? 'unknown'}`,
    type: detectDeviceType(),
    runner_version: '0.0.1',
  },
  capabilities: ['claude-agent-sdk', 'cli-stream-json', 'fake'],
  adapter,
});

await client.start();
logger.info('runner started', { url: SERVER_URL });

const shutdown = async (sig: string) => {
  logger.info('shutting down', { signal: sig });
  await client.stop();
  process.exit(0);
};
process.on('SIGINT',  () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection', { err: String(err) });
});
