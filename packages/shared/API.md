# e2e-bridge — API Reference

> Single source of truth for HTTP endpoints, WebSocket envelopes, events, commands, and shared types.
> All schemas live in [`src/schemas.ts`](src/schemas.ts) as zod schemas — this document mirrors them.

## Versioning

- Server ↔ client / runner protocol is `1.0` (M1 baseline).
- Breaking changes require bumping the version and adding negotiation in `hello` / `hello_ack`.

## Auth

| Endpoint | Auth | Notes |
|---|---|---|
| HTTP `GET /health` | none | for load balancer / liveness |
| HTTP `*` | `Authorization: Bearer <ADMIN_TOKEN>` | constant-time compare |
| WS `/ws/app` | `hello.token` | token validated in `hello` |
| WS `/ws/runner` | `hello.pairing_token` | one-time pairing, server returns `runner_id` |

Tokens come from env: `ADMIN_TOKEN`, `RUNNER_PAIRING_TOKEN`. Never log them.

## HTTP API

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET  | `/health` | — | `{ ok: true, version, ts }` | liveness |
| POST | `/api/auth/test` | `{ token }` | `{ ok: true }` or `401` | client token sanity check |
| GET  | `/api/devices` | — | `Device[]` | online + offline runners |
| GET  | `/api/sessions` | `?status=&page=&page_size=` | `Page<Session>` | paginated |
| POST | `/api/sessions` | `{ repo_path, title?, claude_session_id? }` | `Session` | creates session; status=`created` |
| GET  | `/api/sessions/:id` | — | `Session` | 404 if unknown |
| POST | `/api/sessions/:id/messages` | `{ content, attachments? }` | `Message` | sends to runner, returns user-side Message |
| POST | `/api/sessions/:id/commands` | `Command` | `{ command_event_id }` | parses slash into structured Command |
| POST | `/api/sessions/:id/stop` | — | `{ ok: true }` | graceful stop |
| POST | `/api/sessions/:id/kill` | — | `{ ok: true }` | force kill |
| GET  | `/api/sessions/:id/history` | — | `{ messages: Message[], events: Event[] }` | full audit |
| GET  | `/api/skills` | — | `Skill[]` | static list of installed skills |
| POST | `/api/uploads` | multipart/form-data | `Attachment` | size ≤ 10 MB, mime allowlist |
| POST | `/api/hitl/:id/decision` | `{ decision, note? }` | `HitlRequest` | updates request status |

## Slash Commands

All `/commands` HTTP body or `WsClientToServer.send_command.command` use this discriminated union:

| Name | Payload | Description |
|---|---|---|
| `/help` | — | list available commands |
| `/new` | `{ repo_path, title? }` | create session for a repo |
| `/sessions` | `{ status? }` | list sessions |
| `/status` | — | current session status |
| `/stop` | — | graceful stop |
| `/kill` | — | force kill |
| `/skills` | — | list skills |
| `/skill` | `{ skill, args? }` | invoke a skill |
| `/browser` | `{ action, target?, args? }` | browser bridge op |
| `/screenshot` | — | quick screenshot |
| `/trace` | `{ session_id?, format? }` | export trace |
| `/review` | `{ target }` | code review |
| `/test` | `{ goal }` | E2E test |
| `/clear` | — | clear current context |

## Skills (initial set)

| Skill | Purpose |
|---|---|
| `browser-webbridge-testing` | inspect / drive Kimi WebBridge browser session |
| `playwright-test-skill` | write/update Playwright tests, run self-test |
| `code-review-skill` | structured PR / diff review with risk flags |
| `trace-analysis-skill` | read runner JSONL trace, summarize events |

## Events (server → client, runner → server)

Discriminated by `type`. Every event has `ts: ISO-8601`.

### Device

```ts
{ type: 'device.online',  ts, device: Device }
{ type: 'device.offline', ts, device_id: Id }
```

### Session

```ts
{ type: 'session.created',          ts, session: Session }
{ type: 'session.started',          ts, session_id, runner_id }
{ type: 'session.output.delta',     ts, session_id, delta: string, index: number }
{ type: 'session.message',          ts, session_id, message: Message }
{ type: 'session.status_changed',   ts, session_id, from: SessionStatus, to: SessionStatus, reason? }
{ type: 'session.completed',        ts, session_id, result? }
{ type: 'session.failed',           ts, session_id, error: string }
{ type: 'session.stopped',          ts, session_id, by: 'user'|'system'|'runner' }
```

### Task

```ts
{ type: 'task.created',   ts, task_id, session_id, kind, payload? }
{ type: 'task.started',   ts, task_id }
{ type: 'task.completed', ts, task_id, result? }
{ type: 'task.failed',    ts, task_id, error }
```

### Command / Skill / Tool / Browser

```ts
{ type: 'command.received', ts, session_id, command: Command, from_user }
{ type: 'command.executed', ts, session_id, command, result? }
{ type: 'skill.invoked',    ts, session_id, skill, args? }
{ type: 'tool.call',        ts, session_id, tool_call_id, tool, args }
{ type: 'tool.result',      ts, session_id, tool_call_id, result, is_error? }
{ type: 'browser.event',    ts, session_id, action: BrowserAction, target?, summary }
```

### Upload

```ts
{ type: 'upload.created',  ts, upload_id, filename, mime, size }
{ type: 'upload.attached', ts, upload_id, session_id, message_id }
```

### HITL

```ts
{ type: 'hitl.requested', ts, request: HitlRequest }
{ type: 'hitl.decided',   ts, hitl_id, decision: HitlDecision, decided_by, note? }
```

### Error

```ts
{ type: 'error', ts, code, message, context? }
```

## WebSocket envelopes

### Client → Server (`/ws/app`)

```ts
{ type: 'hello',          token }
{ type: 'subscribe',      session_id? }            // omit = all
{ type: 'unsubscribe',    session_id }
{ type: 'send_message',   session_id, content, attachments? }
{ type: 'send_command',   session_id, command: Command }
{ type: 'hitl_decide',    hitl_id, decision: HitlDecision, note? }
{ type: 'ping' }
```

### Server → Client

```ts
{ type: 'hello_ack', user_id, server_version }
{ type: 'event',     event: Event }
{ type: 'error',     code, message }
{ type: 'pong' }
```

### Runner → Server (`/ws/runner`)

```ts
{ type: 'hello',  pairing_token, device, capabilities }
{ type: 'event',  event: Event }
{ type: 'pong' }
```

### Server → Runner

```ts
{ type: 'hello_ack',    runner_id, config: { repo_allowlist, heartbeat_interval_ms } }
{ type: 'run_message',  session_id, content, attachments? }
{ type: 'run_command',  session_id, command: Command }
{ type: 'ping' }
```

## Error codes

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | bad / missing token |
| `NOT_FOUND` | session / device / hitl not found |
| `BAD_REQUEST` | schema validation failed |
| `CONFLICT` | session already in terminal state |
| `NO_RUNNER` | no online runner can accept this session |
| `REPO_NOT_ALLOWED` | runner repo_allowlist rejected repo_path |
| `UPLOAD_TOO_LARGE` | > 10 MB |
| `UPLOAD_BAD_MIME` | not in SAFE_MIME list |
| `HITL_NOT_PENDING` | tried to decide already-decided HITL |
| `INTERNAL` | unexpected server error |

## Limits

- Attachment size: **10 MB** max
- Attachment mime: `image/png`, `image/jpeg`, `image/webp`, `text/plain`, `application/pdf`
- Message content: **100 000** chars max
- Repo path: required, must be in runner's `repo_allowlist`
- WebSocket heartbeat: server pings every **30s**; close on no pong for **60s**
