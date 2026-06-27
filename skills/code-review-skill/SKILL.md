---
name: code-review-skill
description: Structured code review with risk flags for the current diff or branch. Use when the user asks to "review", "audit", or "check" a change before merge or deploy.
---

# Code Review Skill

## When to use
- The user asks to review a PR, branch, file, or staged change.
- The user wants a risk assessment before merge or deploy.
- Output expected is a list of issues categorized by severity.

## Pre-conditions
1. Determine the change scope: `git diff main...HEAD`, `git diff --staged`, or an explicit file list.
2. Confirm the repo allowlist (runner-side).
3. **HITL required** for any suggestion that would: push to remote, force-push, delete branches, rewrite git history, or modify CI/CD config outside the repo.

## Steps
1. Capture the diff: `git diff <base>...HEAD --stat` for an overview, then full diff for review.
2. For each file:
   - Read the full file (not just the diff) for context.
   - Note: type changes, API changes, schema changes, auth changes, secret handling, persistence layer, migrations.
3. Categorize each finding:
   - **CRITICAL**: data loss, security hole, secret leak, broken contract → blocks merge
   - **HIGH**: race condition, missing error handling, performance regression → should fix before merge
   - **MEDIUM**: code clarity, missing tests for the changed path, weak types → fix in this PR
   - **LOW**: nit, style, comment cleanup → optional
4. For each finding give: file:line, category, 1-line description, suggested fix.

## Output format
```
REVIEW: <summary line>

CRITICAL (n)
- path/to/file.ts:123 — short description — fix: ...

HIGH (n)
- ...

MEDIUM (n)
- ...

LOW (n)
- ...

VERDICT: APPROVE / REQUEST CHANGES / BLOCK
```

## Constraints
- **No** comments about style preferences (formatting, import order) unless they obscure bugs.
- **No** "you should also..." suggestions outside the diff scope — file follow-up issues instead.
- **No** recommending to merge if any CRITICAL finding is unaddressed.
- **No** disclosing secrets found in the diff in the report — redact and call out "secret found, see file:line" without quoting it.
- Always run the project's own linter/typechecker before declaring APPROVE.

## Failure modes
- Diff too large (>1000 lines) → split into logical chunks and review in order; flag overall risk in the summary.
- Tests don't run in this environment → report which checks were skipped.
- Repository has no linter configured → note this; do not silently skip.
