# prj-bridge-phone / e2e-bridge

Self-hosted bridge: Mobile/Web client → ECS Control Server ←WebSocket— Local Runner → Claude Agent SDK.

> The directory name is `prj-bridge-phone` for legacy reasons; the project is `e2e-bridge`.

- Full spec: [`docs/GOAL.md`](docs/GOAL.md)
- API: [`packages/shared/API.md`](packages/shared/API.md)
- Deploy: will be filled in Milestone 9

## Structure

```
.
├── apps/
│   └── server/         ECS Control Server (M2)
├── packages/
│   └── shared/         zod schemas + types (M1)
└── docs/
    └── GOAL.md
```

## Status

- [x] **M1** Shared protocol (zod schemas + docs/API.md)
- [ ] **M2** Control server (HTTP + WS + token auth + fake stream)
- [ ] M3 Local runner
- [ ] M4 Claude SDK real integration
- [ ] M5 Web PWA
- [ ] M6 Skills
- [ ] M7 Browser bridge
- [ ] M8 Uploads
- [ ] M9 Deployment

## Quick start

```bash
pnpm install
pnpm typecheck
pnpm build
```

## Security

- ❌ Never print `ADMIN_TOKEN` or AccessKey
- ❌ Never commit `.env`
- ❌ Never expose raw shell / SSH / Claude Code / MCP ports
- ✅ Mobile/Web only talks to ECS Control Server
- ✅ Runner only connects outbound to ECS via WebSocket
