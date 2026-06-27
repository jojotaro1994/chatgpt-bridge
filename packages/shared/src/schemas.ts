import { z } from 'zod';

// ============================================================================
// Primitives
// ============================================================================

export const Id = z.string().min(1).max(128);
export type Id = z.infer<typeof Id>;

export const Timestamp = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

// ============================================================================
// Enums
// ============================================================================

export const SessionStatus = z.enum([
  'created',
  'running',
  'completed',
  'failed',
  'stopped',
  'killed',
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const Role = z.enum(['user', 'assistant', 'system']);
export type Role = z.infer<typeof Role>;

export const RiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const HitlStatus = z.enum([
  'pending',
  'approved',
  'rejected',
  'modified',
  'aborted',
]);
export type HitlStatus = z.infer<typeof HitlStatus>;

export const HitlDecision = z.enum([
  'approve',
  'reject',
  'modify',
  'abort',
]);
export type HitlDecision = z.infer<typeof HitlDecision>;

export const DeviceType = z.enum(['mac', 'linux', 'windows']);
export type DeviceType = z.infer<typeof DeviceType>;

export const DeviceStatus = z.enum(['online', 'offline']);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const BrowserAction = z.enum([
  'status',
  'inspect',
  'screenshot',
  'click',
  'fill',
  'extract',
  'trace',
]);
export type BrowserAction = z.infer<typeof BrowserAction>;

// ============================================================================
// Domain objects
// ============================================================================

export const SAFE_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'application/pdf',
] as const;

export const Attachment = z.object({
  id: Id,
  filename: z.string().min(1).max(255),
  mime: z.enum(SAFE_MIME),
  size: z.number().int().min(1).max(10 * 1024 * 1024), // 10 MB
  url: z.string().url(),
  session_id: Id.optional(),
  created_at: Timestamp,
});
export type Attachment = z.infer<typeof Attachment>;

export const AttachmentId = Id;
export type AttachmentId = z.infer<typeof AttachmentId>;

export const Message = z.object({
  id: Id,
  session_id: Id,
  role: Role,
  content: z.string().max(100_000),
  attachments: z.array(AttachmentId).optional(),
  created_at: Timestamp,
});
export type Message = z.infer<typeof Message>;

export const Session = z.object({
  id: Id,
  status: SessionStatus,
  runner_id: Id.nullable(),
  repo_path: z.string().min(1),
  title: z.string().max(255).optional(),
  claude_session_id: z.string().optional(),
  created_at: Timestamp,
  updated_at: Timestamp,
  history_count: z.number().int().min(0).default(0),
});
export type Session = z.infer<typeof Session>;

export const Device = z.object({
  id: Id,
  name: z.string().min(1).max(100),
  type: DeviceType,
  runner_version: z.string(),
  status: DeviceStatus,
  last_seen: Timestamp,
  capabilities: z.array(z.string()).default([]),
});
export type Device = z.infer<typeof Device>;

export const HitlRequest = z.object({
  id: Id,
  session_id: Id,
  risk_level: RiskLevel,
  action: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  status: HitlStatus,
  created_at: Timestamp,
  decided_at: Timestamp.optional(),
  decided_by: z.string().optional(),
  decision: HitlDecision.optional(),
  decision_note: z.string().optional(),
});
export type HitlRequest = z.infer<typeof HitlRequest>;

// ============================================================================
// Slash commands (server/runner parses into structured Command)
// ============================================================================

export const Command = z.discriminatedUnion('name', [
  z.object({ name: z.literal('help') }),
  z.object({
    name: z.literal('new'),
    repo_path: z.string().min(1),
    title: z.string().max(255).optional(),
  }),
  z.object({
    name: z.literal('sessions'),
    status: SessionStatus.optional(),
  }),
  z.object({ name: z.literal('status') }),
  z.object({ name: z.literal('stop') }),
  z.object({ name: z.literal('kill') }),
  z.object({ name: z.literal('skills') }),
  z.object({
    name: z.literal('skill'),
    skill: z.string().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    name: z.literal('browser'),
    action: BrowserAction,
    target: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ name: z.literal('screenshot') }),
  z.object({
    name: z.literal('trace'),
    session_id: Id.optional(),
    format: z.enum(['jsonl', 'json']).optional(),
  }),
  z.object({ name: z.literal('review'), target: z.string().min(1) }),
  z.object({ name: z.literal('test'), goal: z.string().min(1) }),
  z.object({ name: z.literal('clear') }),
]);
export type Command = z.infer<typeof Command>;

// ============================================================================
// Events (server → client, runner → server)
// Discriminated union by `type`. Every event has a `ts` ISO-8601 timestamp.
// ============================================================================

// Helper: build an event schema with `type` literal, `ts`, and user payload.
// Using `<const T>` preserves the literal string type so the discriminated union
// can dispatch on it.
const evt = <const T extends string, S extends z.ZodRawShape>(
  type: T,
  shape: S,
) => z.object({ type: z.literal(type), ts: Timestamp, ...shape });

export const Event = z.discriminatedUnion('type', [
  // ---- device ----
  evt('device.online',  { device: Device }),
  evt('device.offline', { device_id: Id }),

  // ---- session ----
  evt('session.created',          { session: Session }),
  evt('session.started',          { session_id: Id, runner_id: Id }),
  evt('session.output.delta',     { session_id: Id, delta: z.string(), index: z.number().int().min(0) }),
  evt('session.message',          { session_id: Id, message: Message }),
  evt('session.status_changed',   { session_id: Id, from: SessionStatus, to: SessionStatus, reason: z.string().optional() }),
  evt('session.completed',        { session_id: Id, result: z.unknown().optional() }),
  evt('session.failed',           { session_id: Id, error: z.string() }),
  evt('session.stopped',          { session_id: Id, by: z.enum(['user', 'system', 'runner']) }),

  // ---- task ----
  evt('task.created',   { task_id: Id, session_id: Id, kind: z.string(), payload: z.unknown().optional() }),
  evt('task.started',   { task_id: Id }),
  evt('task.completed', { task_id: Id, result: z.unknown().optional() }),
  evt('task.failed',    { task_id: Id, error: z.string() }),

  // ---- command ----
  evt('command.received', { session_id: Id, command: Command, from_user: z.string() }),
  evt('command.executed', { session_id: Id, command: Command, result: z.unknown().optional() }),

  // ---- skill ----
  evt('skill.invoked', { session_id: Id, skill: z.string(), args: z.record(z.string(), z.unknown()).optional() }),

  // ---- tool ----
  evt('tool.call',   { session_id: Id, tool_call_id: Id, tool: z.string(), args: z.record(z.string(), z.unknown()) }),
  evt('tool.result', { session_id: Id, tool_call_id: Id, result: z.unknown(), is_error: z.boolean().optional() }),

  // ---- browser ----
  evt('browser.event', { session_id: Id, action: BrowserAction, target: z.string().optional(), summary: z.string() }),

  // ---- upload ----
  evt('upload.created',  { upload_id: Id, filename: z.string(), mime: z.enum(SAFE_MIME), size: z.number().int().min(1) }),
  evt('upload.attached', { upload_id: Id, session_id: Id, message_id: Id }),

  // ---- HITL ----
  evt('hitl.requested', { request: HitlRequest }),
  evt('hitl.decided',   { hitl_id: Id, decision: HitlDecision, decided_by: z.string(), note: z.string().optional() }),

  // ---- error ----
  evt('error', { code: z.string(), message: z.string(), context: z.record(z.string(), z.unknown()).optional() }),
]);
export type Event = z.infer<typeof Event>;
export type EventType = Event['type'];

// ============================================================================
// WebSocket envelopes
// ============================================================================

// ---- client → server ----
export const WsClientToServer = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    token: z.string().min(1),
  }),
  z.object({
    type: z.literal('subscribe'),
    // omit = subscribe to all events the user is allowed to see
    session_id: Id.optional(),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    session_id: Id,
  }),
  z.object({
    type: z.literal('send_message'),
    session_id: Id,
    content: z.string().min(1).max(100_000),
    attachments: z.array(AttachmentId).optional(),
  }),
  z.object({
    type: z.literal('send_command'),
    session_id: Id,
    command: Command,
  }),
  z.object({
    type: z.literal('hitl_decide'),
    hitl_id: Id,
    decision: HitlDecision,
    note: z.string().max(2000).optional(),
  }),
  z.object({ type: z.literal('ping') }),
]);
export type WsClientToServer = z.infer<typeof WsClientToServer>;

// ---- server → client ----
export const WsServerToClient = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello_ack'),
    user_id: Id,
    server_version: z.string(),
  }),
  z.object({
    type: z.literal('event'),
    event: Event,
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
  z.object({ type: z.literal('pong') }),
]);
export type WsServerToClient = z.infer<typeof WsServerToClient>;

// ---- runner → server ----
export const WsRunnerToServer = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    pairing_token: z.string().min(1),
    // device WITHOUT id (server generates) and WITHOUT status/last_seen
    device: z.object({
      name: z.string().min(1).max(100),
      type: DeviceType,
      runner_version: z.string(),
    }),
    capabilities: z.array(z.string()),
  }),
  z.object({
    type: z.literal('event'),
    event: Event,
  }),
  z.object({ type: z.literal('pong') }),
]);
export type WsRunnerToServer = z.infer<typeof WsRunnerToServer>;

// ---- server → runner ----
export const WsServerToRunner = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello_ack'),
    runner_id: Id,
    config: z.object({
      repo_allowlist: z.array(z.string()),
      heartbeat_interval_ms: z.number().int().min(1000),
    }),
  }),
  z.object({
    type: z.literal('run_message'),
    session_id: Id,
    content: z.string(),
    attachments: z.array(AttachmentId).optional(),
  }),
  z.object({
    type: z.literal('run_command'),
    session_id: Id,
    command: Command,
  }),
  z.object({ type: z.literal('ping') }),
]);
export type WsServerToRunner = z.infer<typeof WsServerToRunner>;
