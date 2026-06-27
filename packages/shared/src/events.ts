import { z } from 'zod';
import { Event, type EventType } from './schemas.js';

/**
 * Parse and validate a raw unknown payload into an Event.
 * Throws ZodError if invalid — use safeParse for non-throwing variant.
 */
export function parseEvent(input: unknown): Event {
  return Event.parse(input);
}

export function safeParseEvent(
  input: unknown,
): z.SafeParseReturnType<unknown, Event> {
  return Event.safeParse(input);
}

/** Type guard factory: `isEventType('session.output.delta')(e)` */
export function isEventType<T extends EventType>(type: T) {
  return (e: Event): e is Extract<Event, { type: T }> => e.type === type;
}

// Pre-baked common guards
export const isSessionDelta = isEventType('session.output.delta');
export const isSessionMessage = isEventType('session.message');
export const isSessionCompleted = isEventType('session.completed');
export const isSessionFailed = isEventType('session.failed');
export const isSessionStatusChanged = isEventType('session.status_changed');
export const isHitlRequested = isEventType('hitl.requested');
export const isHitlDecided = isEventType('hitl.decided');
export const isDeviceOnline = isEventType('device.online');
export const isDeviceOffline = isEventType('device.offline');
export const isError = isEventType('error');

/** Stable, sorted list of all event types — useful for /skills introspection. */
export const ALL_EVENT_TYPES: readonly EventType[] = Event.options.map(
  (o) => o.shape.type.value,
).sort() as EventType[];
