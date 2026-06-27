# apps/web — Next.js PWA Control Client

Mobile-first web app to drive `e2e-bridge` from any browser. Talks to the ECS
Control Server over HTTP (`/api/*`) and WebSocket (`/ws/app`).

## Run (dev)

```bash
pnpm -F @e2e-bridge/web dev
# open http://localhost:3001
```

Enter the ECS server URL (e.g. `http://39.107.221.39`) and your `ADMIN_TOKEN`.
The token + URL are stored in `localStorage` so reloads don't ask again.

## Build (prod)

```bash
pnpm -F @e2e-bridge/web build
pnpm -F @e2e-bridge/web start
```

For ECS deployment, copy `.next/` into the Docker image or run `next start`
behind the existing Nginx (server already proxies `/ws/app` and `/api/*`).

## Pages

| Path | Purpose |
|---|---|
| `/`              | Setup: server URL + admin token |
| `/dashboard`     | Devices · Sessions · Skills |
| `/session/:id`   | Chat: stream, slash cmds, upload, HITL card, trace |

## Security

- Token lives only in `localStorage`. Never logged, never sent in URLs except the one-shot `/ws/app?token=` upgrade.
- The web client never reaches SSH, Claude Code, or MCP directly — only the public ECS server.
- Uploads go to `POST /api/uploads` (size + mime enforced server-side).
- HITL card requires explicit decision before any destructive action runs.
