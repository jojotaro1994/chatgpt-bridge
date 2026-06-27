---
name: playwright-test-skill
description: Write, update, or run Playwright tests in the current repo. Use when the user asks to add a regression test, fix a flaky E2E test, or run the existing Playwright suite.
---

# Playwright Test Skill

## When to use
- The user wants to add, refactor, or debug an E2E test using Playwright.
- The user wants to run `npx playwright test` and understand the results.
- Goal is a green test run with a clear failure summary if any.

## Pre-conditions
1. Confirm Playwright is installed: check `package.json` for `@playwright/test`, otherwise install (`pnpm add -D @playwright/test && pnpm exec playwright install --with-deps`).
2. Check the repo allowlist (runner-side) — only operate in allowlisted repos.
3. If running real tests against a live URL → HITL required for any state-changing test.

## Steps

### Writing a new test
1. Locate or create `tests/e2e/<feature>.spec.ts`.
2. Use stable selectors: `getByRole`, `getByTestId`, `getByLabel` — avoid CSS/XPath that depend on layout.
3. Wait for network-idle or explicit selectors; never `waitForTimeout` for production logic.
4. Group related assertions; one test = one user-visible behavior.
5. Add a comment linking back to the bug/issue this test guards against.

### Running tests
1. `pnpm exec playwright test <path-or-pattern>` for a subset.
2. `pnpm exec playwright test` for full suite.
3. On failure: read the error, screenshot, and trace. Don't blindly retry.

### Fixing flaky tests
1. Identify the source of non-determinism: timing, network, animation, auth state.
2. Replace `waitForTimeout` with proper auto-waits or explicit element/state waits.
3. Isolate state: use `test.beforeEach` to seed a clean state.
4. Re-run 3 times locally to confirm stability.

## Output format
- Final line: `PLAYWRIGHT: PASS (n tests)` or `PLAYWRIGHT: FAIL (k of n failed)`.
- For each failure: file:line, expected vs. actual, screenshot path.

## Constraints
- **No** `page.waitForTimeout(5000)` for production logic — use proper waits.
- **No** `--headed=false` overrides in CI; the default is correct.
- **No** test files that commit real credentials. Use `process.env.*` and a `.env.test` (gitignored).
- **No** mutations to production data; use test fixtures.
- Don't suppress failing tests (`test.skip` / `test.fixme`) without an inline TODO and link to the tracking issue.

## Failure modes
- Playwright not installed → install and note versions in the report.
- Browser binary missing → `pnpm exec playwright install --with-deps`.
- Test environment down → report URL/service and stop; do not retry blindly.
