import type { Event, SessionId } from '@e2e-bridge/shared';
import { logger } from './logger.js';

export type Subscriber = (event: Event) => void;
export type Unsubscribe = () => void;

/**
 * In-process event bus. Clients subscribe to:
 *   - session_id present: only events whose session_id === that (or no session_id)
 *   - session_id absent:   all events the subscriber is allowed to see
 *
 * For M2 this is a single-process pub/sub; later we can swap in Redis/NATS
 * without changing the public surface.
 */
export class EventDispatcher {
  private bySession = new Map<string, Set<Subscriber>>();
  private global = new Set<Subscriber>();

  /** Subscribe. `sessionId` === null means "all events". Returns unsubscribe fn. */
  subscribe(sessionId: string | null, fn: Subscriber): Unsubscribe {
    if (sessionId === null) {
      this.global.add(fn);
      return () => this.global.delete(fn);
    }
    let set = this.bySession.get(sessionId);
    if (!set) {
      set = new Set();
      this.bySession.set(sessionId, set);
    }
    set.add(fn);
    return () => {
      const s = this.bySession.get(sessionId);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.bySession.delete(sessionId);
    };
  }

  /** Dispatch an event. */
  dispatch(event: Event): void {
    // Global subs
    for (const fn of this.global) {
      try { fn(event); } catch (err) {
        logger.error('global sub threw', { err: String(err) });
      }
    }

    // Session-specific subs. We sniff session_id off the event payload.
    const sid = sessionIdOf(event);
    if (!sid) return;
    const set = this.bySession.get(sid);
    if (!set) return;
    for (const fn of set) {
      try { fn(event); } catch (err) {
        logger.error('session sub threw', { err: String(err), session_id: sid });
      }
    }
  }

  /** Total subscriber count — for /health and tests. */
  size(): number {
    let n = this.global.size;
    for (const s of this.bySession.values()) n += s.size;
    return n;
  }
}

function sessionIdOf(e: Event): string | null {
  // Discriminated-union-safe read.
  if ('session_id' in e && typeof (e as { session_id?: unknown }).session_id === 'string') {
    return (e as { session_id: string }).session_id;
  }
  if (e.type === 'session.created') return e.session.id;
  if (e.type === 'hitl.requested') return e.request.session_id;
  if (e.type === 'upload.attached') return e.session_id;
  if (e.type === 'device.online') return null;
  if (e.type === 'device.offline') return null;
  if (e.type === 'error') return null;
  return null;
}

/** Singleton dispatcher. */
export const dispatcher = new EventDispatcher();

export type { SessionId };
