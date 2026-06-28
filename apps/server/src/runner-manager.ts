import type { WebSocket } from 'ws';
import type { WsServerToRunner } from '@e2e-bridge/shared';
import { logger } from './logger.js';

/**
 * Tracks live runner WebSockets by runner_id. A session is just a logical id;
 * any online runner can handle any session (the runner is the worker; it
 * doesn't need to know about session lifecycle on the server).
 *
 * For M9 + M4 integration: when a runner is online, the HTTP /messages and
 * /commands routes forward to it via WS. When no runner is online, we fall
 * back to the built-in FakeRunner (existing behavior).
 *
 * Forwarding pattern (no request/correlation id needed):
 *   1. server sends { type: 'run_message' | 'run_command', session_id, ... }
 *      over the runner's WS
 *   2. runner runs the adapter and emits { type: 'event', event } envelopes
 *   3. server ws handler already dispatches these via EventDispatcher
 *   4. clients subscribed to /ws/app receive the events as a stream
 */
export class RunnerManager {
  private runners = new Map<string, WebSocket>();

  add(runnerId: string, ws: WebSocket): void {
    this.runners.set(runnerId, ws);
    logger.info('runner added', { runner_id: runnerId, total: this.runners.size });
  }

  remove(runnerId: string): void {
    if (this.runners.delete(runnerId)) {
      logger.info('runner removed', { runner_id: runnerId, total: this.runners.size });
    }
  }

  count(): number {
    return this.runners.size;
  }

  /** Pick any open runner. Returns null if none. */
  pick(): { runnerId: string; ws: WebSocket } | null {
    for (const [runnerId, ws] of this.runners) {
      if (ws.readyState === ws.OPEN) return { runnerId, ws };
    }
    return null;
  }

  /** Send a typed message to a runner. Returns true on success. */
  send(runnerId: string, msg: WsServerToRunner): boolean {
    const ws = this.runners.get(runnerId);
    if (!ws || ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }
}

export const runnerManager = new RunnerManager();
