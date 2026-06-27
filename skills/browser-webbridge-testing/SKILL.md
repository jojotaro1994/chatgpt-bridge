---
name: browser-webbridge-testing
description: Drive a browser through Kimi WebBridge (or Playwright MCP) for E2E user-flow testing, login screens, and stream-response verification. Use when the user asks to test, verify, or click through a web UI without leaving the host computer.
---

# Browser WebBridge Testing

## When to use
- The user asks to "test", "verify", "click through", or "smoke" a web flow.
- Goal is to exercise a real browser session against a real (or local) URL.
- Output expected is a pass/fail summary, plus a list of browser events.

## Pre-conditions
1. **HITL required** for any action that submits a form with credentials, makes a payment, deletes data, or modifies production config. Ask first.
2. Verify the browser bridge tool is available (e.g. `mcp__kimi__*` or `mcp__playwright__*`). If it isn't, stop and tell the user which MCP server is missing.
3. Identify the target URL. If the user didn't provide one, ask.
4. Confirm the repo allowlist covers the repo you'll be touching (runner-side check).

## Steps
1. Open the page (`browser.goto` or equivalent) and wait for network-idle.
2. Take a screenshot of the initial state.
3. For each step in the test plan:
   a. Locate the target element via a stable selector (`data-testid` preferred; CSS selector next; never XPath index).
   b. If the action is destructive or irreversible → request HITL.
   c. Perform the action.
   d. Wait for the response (network-idle or explicit waitForSelector).
   e. Capture a screenshot.
4. Compare expected vs. actual outcomes per step.
5. Produce a pass/fail report.

## Output format
- One section per step with: status, screenshot reference, evidence (selector + observed text/value), and any deviation.
- Final line: `RESULT: PASS` or `RESULT: FAIL (n issues)`.

## Constraints
- **No** automated payment submissions, real emails, real SMS, or destructive DB writes without explicit HITL approval per action.
- **No** headless browser flags that disable security (e.g. `--disable-web-security`).
- **No** permanent state changes outside the test scope (don't leave logged-in sessions, don't create throwaway accounts on real services).
- **No** TUI parsing; use the bridge/MCP tool surface only.
- If the page requires authentication, prefer a test account or read-only token; never use the user's own credentials.

## Failure modes
- Bridge unavailable → stop and report missing MCP server.
- Element not found → report selector + take a screenshot + suggest a more stable selector.
- Action requires HITL and user denies → abort the run, do not retry silently.
- Page errors → capture console + network errors and include in the report.
