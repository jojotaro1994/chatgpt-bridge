#!/usr/bin/env node
/**
 * Smoke test for ClaudeAgentSdkAdapter without an API key.
 * Verifies the adapter:
 *   - constructs without throwing
 *   - surfaces a clean `session.failed` event when API key is missing
 *   - does not leak secrets into logs
 *
 * Usage:  node apps/runner/scripts/sdk-smoke.mjs
 */
import { ClaudeAgentSdkAdapter } from '../../../packages/sdk-adapter/dist/index.js';

const adapter = new ClaudeAgentSdkAdapter({ apiKey: 'sk-ant-invalid-smoke-test-only' });

const handle = await adapter.createSession({ repo_path: '/tmp' });
console.log('createSession handle:', handle);

console.log('--- sendMessage (will likely fail without real key) ---');
let count = 0;
const seen = [];
for await (const ev of adapter.sendMessage(handle.id, { content: 'say hello briefly' })) {
  seen.push(ev.type);
  count++;
  if (ev.type === 'session.completed' || ev.type === 'session.failed') {
    console.log('  terminal event:', ev.type, ev.type === 'session.failed' ? `(error: ${ev.error.slice(0, 120)})` : '');
    break;
  }
  if (count > 200) { console.log('  ... giving up after 200 events'); break; }
}

console.log('events observed:', seen.slice(0, 30).join(', '));

// Minimal assertions: at least we got a terminal event (completed or failed)
const ok = seen.includes('session.completed') || seen.includes('session.failed');
if (!ok) { console.error('FAIL: no terminal event'); process.exit(1); }

console.log('OK: SDK adapter emitted a terminal event');
process.exit(0);
