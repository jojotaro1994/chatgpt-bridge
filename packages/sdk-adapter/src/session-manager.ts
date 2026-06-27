import type { Event, Id } from '@e2e-bridge/shared';
import type { ClaudeSessionAdapter } from './types.js';
import { nowIso } from './util.js';

/**
 * SessionManager — coordinates adapter sessions and emits lifecycle events.
 * Multiple `sendMessage` calls on the same session are serialized.
 */
export class SessionManager {
  private locks = new Map<Id, Promise<void>>();

  constructor(private adapter: ClaudeSessionAdapter) {}

  async *forward(sessionId: Id, source: AsyncIterable<Event>): AsyncIterable<Event> {
    // Serialize per-session
    const prev = this.locks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.locks.set(sessionId, prev.then(() => next));
    try {
      await prev;
      for await (const ev of source) {
        yield ev;
      }
    } finally {
      release();
      if (this.locks.get(sessionId) === next) this.locks.delete(sessionId);
    }
  }

  async stop(sessionId: Id): Promise<void> {
    await this.adapter.stopSession(sessionId);
  }

  async kill(sessionId: Id): Promise<void> {
    await this.adapter.killSession(sessionId);
  }

  /** Helper: a tick event with a particular timestamp. */
  static tick(sessionId: Id, delta: string, index: number): Event {
    return { type: 'session.output.delta', ts: nowIso(), session_id: sessionId, delta, index };
  }
}
