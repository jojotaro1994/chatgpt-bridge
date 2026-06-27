---
name: trace-analysis-skill
description: Read a runner JSONL trace and summarize what happened. Use when the user asks to "analyze trace", "debug session", or "what did Claude do" with a session id.
---

# Trace Analysis Skill

## When to use
- The user provides a `trace.jsonl` or asks for analysis of a past session.
- The user asks why a session failed, hung, or produced unexpected output.
- Output expected is a timeline + per-event interpretation + root cause hypothesis.

## Pre-conditions
1. Locate the trace file. Common locations:
   - `<runner-cwd>/trace/<session_id>.jsonl`
   - `<runner-cwd>/.e2e-bridge/trace/<session_id>.jsonl`
   - The user provides a path.
2. If no path is available, ask.
3. The trace is JSONL: one event per line, each line a unified `Event` from `@e2e-bridge/shared`.

## Steps
1. Parse the file: read each line, JSON.parse, skip blanks.
2. Group by session_id; produce a per-session timeline.
3. For each session, identify:
   - **Turns**: pairs of `session.message` (user) + assistant `session.output.delta`/`session.message`.
   - **Tool calls**: `tool.call` and the corresponding `tool.result`.
   - **Lifecycle**: `session.created` → `session.started` → status changes → terminal.
   - **Errors**: `session.failed`, `hitl.requested`/`hitl.decided`, `error` events.
4. Compute latency markers: time between `session.created` and first `session.started`; first-to-last delta of a turn; time to `session.completed`/`failed`.
5. Surface anomalies:
   - Long pauses between events (>30s).
   - Tool calls without matching results.
   - HITL requested but never decided (timeout?).
   - Session killed mid-stream.
   - Repeated identical events (possible loop).
6. Form a root-cause hypothesis if the user reported a problem.

## Output format
```
TRACE: <session_id> — <one-line summary>

Timeline
  00:00.000  session.created        …
  00:00.123  session.started        …
  00:01.456  tool.call Read foo.ts
  00:01.789  tool.result (12 lines)
  …

Anomalies
  - [anomaly 1]
  - [anomaly 2]

Hypothesis (if asked)
  <1-3 sentence root cause guess + suggested next step>
```

## Constraints
- **No** PII or secrets in the report — redact anything that looks like a token, email, or credential before quoting.
- **No** modifying the trace file.
- **No** running any tool that touches the original session (don't resume, don't re-send messages).
- If the trace is huge (>10k events), summarize first, then offer to deep-dive into specific events.

## Failure modes
- File missing → ask the user for the path.
- File is not JSONL or malformed → report the bad line numbers and stop.
- Unknown event type → list it as "unknown: <type>" but don't fail.
