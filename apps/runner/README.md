# apps/runner — Local Runner

Connects **outbound** to the ECS server (`/ws/runner`), registers a device,
and forwards server-pushed `run_message` / `run_command` envelopes to a
`ClaudeSessionAdapter` (FakeAdapter by default).

## Run

```bash
# 1. Make sure the server is up (see apps/server).
# 2. Set tokens to match the server's RUNNER_PAIRING_TOKEN.
export RUNNER_PAIRING_TOKEN=...
pnpm -F @e2e-bridge/runner build
pnpm -F @e2e-bridge/runner start
```

You should see:
```
{"level":"info","msg":"connecting to server","url":"ws://127.0.0.1:3000/ws/runner"}
{"level":"info","msg":"runner paired","runner_id":"r_..."}
```

The server's `GET /api/devices` will now list this runner as `online`.

## Adapter choice

| Class | Use when |
|---|---|
| `FakeAdapter`        | M3 demo / tests (always works, no Claude needed) |
| `ClaudeCliAdapter`   | `claude` CLI build supports `--output-format stream-json` |
| `ClaudeAgentSdkAdapter` | `@anthropic-ai/claude-agent-sdk` is installed |

Wire the adapter via env in `src/index.ts` later; for now `FakeAdapter` is hard-wired.

## Security

- Runner is **outbound-only**. Never bind a port on the runner host.
- Runner never receives a `hello_ack.config.repo_allowlist` it can trust blindly — M3 enforces it server-side; M5+ enforces it on the runner side before `createSession`.
- Tokens are redacted from logs.
