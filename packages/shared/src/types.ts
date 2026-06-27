/**
 * Generic utility types used across server / runner / client.
 * No runtime exports here — pure type module.
 */

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type Pagination = {
  page?: number;
  page_size?: number;
};

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

/** Brand type to prevent mixing IDs of different kinds. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type SessionId = Brand<string, 'SessionId'>;
export type RunnerId = Brand<string, 'RunnerId'>;
export type UserId = Brand<string, 'UserId'>;
export type HitlId = Brand<string, 'HitlId'>;
export type UploadId = Brand<string, 'UploadId'>;

/** Pull the payload type for a specific event type. */
export type EventPayload<T extends import('./schemas.js').Event['type']> =
  Extract<import('./schemas.js').Event, { type: T }>;

/** Pull the payload type for a specific command name. */
export type CommandPayload<N extends import('./schemas.js').Command['name']> =
  Extract<import('./schemas.js').Command, { name: N }>;
