# e2e-bridge — Goal

> Self-hosted E2E bridge: Mobile/Web → ECS Control Server ←WS— Local Runner → Claude Agent SDK + browser bridge + E2E test loop.

## Architecture

```
Mobile/Web Client
  -- HTTP/WS -->
ECS Control Server (39.107.221.39, nginx → 127.0.0.1:3000)
  <-- WS (outbound) --
Local Runner (your Mac/PC)
  -- Claude Agent SDK -->
  -- Claude Code sessions + Kimi WebBridge / Playwright MCP / local repo -->
```

## Project Structure

```
e2e-bridge/
├── apps/
│   ├── web/         Next.js PWA control client
│   ├── android/     (later, after PWA stabilizes)
│   ├── server/      ECS Control Server
│   └── runner/      Local Runner (your Mac)
├── packages/
│   ├── shared/      zod schemas, events, commands, types
│   ├── sdk-adapter/ Claude Agent SDK / CLI / session-manager
│   └── trace/       trace-writer, trace-reader, replay-generator
├── skills/
│   ├── browser-webbridge-testing/SKILL.md
│   ├── playwright-test-skill/SKILL.md
│   ├── code-review-skill/SKILL.md
│   └── trace-analysis-skill/SKILL.md
└── docs/
    ├── GOAL.md      (this file)
    ├── API.md
    ├── LOOP.md
    ├── SECURITY.md
    └── DEPLOY.md
```

## Milestones & Acceptance

| # | Milestone | Deliverable | Acceptance |
|---|---|---|---|
| 1 | Shared Protocol | `packages/shared` zod schemas | typecheck pass; API.md complete |
| 2 | Control Server | `apps/server` HTTP + WS + fake stream | /health works; client WS + runner WS connect; fake session streams |
| 3 | Local Runner | `apps/runner` outbound WS + adapter interface | runner online on server; fake session streaming; adapter ready for real SDK |
| 4 | Claude SDK Real | Agent SDK streaming + event mapping | real session "summarize this repo" → web client stream; /skill invocation works |
| 5 | Web PWA | `apps/web` Next.js | server setup → token login → devices → session list → chat → upload → HITL |
| 6 | Skills | 4 SKILL.md files | /skills lists; /skill <name> → SDK input; trace shows invocation |
| 7 | Browser Bridge | WebBridge/Playwright MCP config | Claude can inspect page; risky action refused without HITL |
| 8 | Uploads | POST /api/uploads + storage + mime/size limits | png/jpeg/webp upload; attached to session; appears in history |
| 9 | Deployment | Dockerfile + docker-compose + DEPLOY.md | server on 127.0.0.1:3000; nginx proxies HTTP/WS; mobile can hit http://39.107.221.39; runner connects from local |

## Development Method: Loop Engineering

1. **Intake** — inspect repo, identify gaps, produce short checklist
2. **Plan** — break into milestones, define acceptance, avoid over-engineering
3. **Implement** — one milestone at a time, small commits, zod schemas, explicit protocol
4. **Self-test** — typecheck packages, build server/runner/web, test WS, fake stream, /cmd, /skill, upload, HITL
5. **Review** — security boundaries, no secrets printed, no raw shell, HITL on destructive, code simple
6. **Replan** — on fail: diagnose, minimal fix, re-run
7. **HITL** — stop & ask before dangerous infra/security changes

## Core Capabilities

### 1. Remote Session Control
List online devices, list sessions, create / continue / stop / kill / view history / resume.

### 2. Claude Agent SDK (primary)
Streaming input/output, slash commands, skills, images, MCP tools, session management.
Convert SDK stream events → unified events. Preserve our own session history in server DB.

### 3. CLI Fallback
Claude CLI with `--output-format stream-json`, `--input-format stream-json`, `--session-id`, `--resume`, `--mcp-config`.
Parse JSON, never parse TUI. node-pty = last resort.

### 4. Browser Bridge
Kimi WebBridge / Playwright MCP. Runner exposes `/browser status|inspect|screenshot|click|fill|extract|trace`. Browser ops go through Claude Code + MCP, not direct.

### 5. Slash Commands
`/help /new /sessions /status /stop /kill /skills /skill <name> /browser /screenshot /trace /review /test /clear`
Parsed server/runner-side into structured command events.

### 6. Skills
`browser-webbridge-testing / playwright-test-skill / code-review-skill / trace-analysis-skill`
Skills are local execution manuals + constraints; `/skill <name>` → SDK input.

### 7. Image/File Upload
- Max 10 MB; safe mimes: image/png, image/jpeg, image/webp, text/plain, application/pdf (optional)
- Server stores attachment; runner downloads / reads local path
- If SDK supports image content → SDK image input; else → local path + instruction
- No inline base64 over WS

### 8. HITL (required for)
git push, deploy, delete/remove, prod config change, send email/SMS/WhatsApp, access secrets, open public ports, change SG, raw shell, kill all sessions, destructive browser.
Card shows: risk level, proposed action, reason, evidence, approve/reject/modify/abort.

### 9. Trace (event types)
device.online/offline · session.{created,started,output.delta,message,status_changed,completed,failed,stopped} · task.{created,started,completed,failed} · command.{received,executed} · skill.invoked · tool.{call,result} · browser.event · upload.{created,attached} · hitl.{requested,decided} · error
Output: server DB + runner local JSONL + optional `trace.jsonl` export.

### 10. E2E Testing Workflow
Goal "Test login flow and stream response behavior" → plan → invoke browser-webbridge-testing skill → Claude uses WebBridge/MCP → safe actions → trace → Playwright test write/run → reviewer → HITL if risky → final report to client.

## Required HTTP APIs

```
GET  /health
POST /api/auth/test
GET  /api/devices
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:id
POST /api/sessions/:id/messages
POST /api/sessions/:id/commands
POST /api/sessions/:id/stop
POST /api/sessions/:id/kill
GET  /api/sessions/:id/history
GET  /api/skills
POST /api/uploads
POST /api/hitl/:id/decision
```

WebSocket:
- `/ws/app` — clients (token auth)
- `/ws/runner` — local runner (pairing token auth)

## Runner Adapter Interface

```ts
interface ClaudeSessionAdapter {
  createSession(input): Promise<SessionHandle>
  sendMessage(sessionId, message): AsyncIterable<ClaudeEvent>
  sendCommand(sessionId, command): AsyncIterable<ClaudeEvent>
  stopSession(sessionId): Promise<void>
  killSession(sessionId): Promise<void>
  listSessions(): Promise<SessionSummary[]>
}
```

## Existing Deployment Context

- ECS: `i-2ze6dlw4h70f0aiwqko5` / cn-beijing-h / Alibaba Cloud Linux 3 / 2 vCPU 2 GB
- Public IP: `39.107.221.39`
- Deploy dir: `~/claude-control-deploy/` (Docker Compose, Nginx conf ready)
- SG: 22 / 80 / 443 / ICMP open; 3389 removed; 3000 not public
- No domain/TLS yet → MVP HTTP/WS first

## Security Rules

- ❌ Do not print `ADMIN_TOKEN`, `AccessKey`, or any secret
- ❌ Do not ask for AccessKey
- ❌ Do not write secrets to files
- ❌ Do not expose raw shell / SSH / Claude Code / Kimi WebBridge / MCP ports directly
- ✅ Mobile/Web only talks to ECS Control Server
- ✅ Runner only connects outbound (WebSocket) to ECS
- ✅ All WS requires auth
- ✅ Repo path allowlist required
- ✅ Upload mime + size limits
- ✅ Destructive commands require HITL
- ❌ Do not modify security groups unless asked
- ❌ Do not rotate AccessKey in this task

## MVP Priority

**Build Web PWA first**, not Android native. Android comes after protocol stabilizes.
**Protocol → fake streams → real SDK → browser bridge** — never start with UI polish.

## MVP Acceptance (E2E)

1. Start ECS server (locally or on ECS)
2. Start runner locally
3. Open web app from phone browser
4. Enter server URL + `ADMIN_TOKEN`
5. See runner online
6. Create new session for allowlisted repo
7. Send "summarize this repo"
8. See streaming Claude output
9. Send `/skills`
10. Send `/skill browser-webbridge-testing`
11. Upload one image
12. Trigger fake HITL
13. Approve HITL
14. Stop session
15. Reopen app, see session history

## Current Scope (this run)

**Milestone 1 + Milestone 2 only.** No Android. No real Claude SDK yet. No browser automation. No UI polish.

M1: shared protocol package (zod schemas + event/command/session/attachment/HITL types).
M2: control server with HTTP + WS + token auth + fake event generator.
