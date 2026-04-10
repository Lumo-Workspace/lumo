# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-10)

**Core value:** Work done in Claude Code flows into the bound Lumo task automatically — live, queryable, no manual ferrying.
**Current focus:** Phase 1 — Data Model and Canonical Schema

## Current Position

Phase: 1 of 6 (Data Model and Canonical Schema)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-04-10 — Roadmap created; all 50 v1 requirements mapped to 6 phases

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
| ----- | ----- | ----- | -------- |
| -     | -     | -     | -        |

**Recent Trend:**

- Last 5 plans: none yet
- Trend: -

_Updated after each plan completion_

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- All phases: Layered architecture enforced (Component → API Client → Route → Service → Repository → Prisma)
- Phase 1: RSC barrel boundary — `lib/integrations/claude-code/` barrel must export ONLY client-safe items (per b7bc170 lesson)
- Phase 1: `sequence` integer (not `createdAt`) is the event ordering key; `@@unique([sessionId, sequence])` is the idempotency constraint
- Phase 2: Ephemeral JWT scoped to `(sessionId, taskId, workspaceId)` — not Clerk session tokens (which expire and cannot be refreshed from shell)
- Phase 3: LIVE SMOKE TEST required at phase start to confirm `tool_response` vs `tool_result` field name and HTTP hook async behavior
- Phase 4: `claude://` deep-link support is LOW confidence — fall back to "Copy CLI command" as primary if undocumented
- All phases: Reuse existing Pusher `task-{taskId}` channel — no new real-time layer; no per-session channels

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 3 depends on a live Claude Code smoke test to resolve `tool_response` vs `tool_result` ambiguity and HTTP hook async behavior — cannot be resolved by documentation alone. Unblock at Phase 3 start.
- Rate limiting library choice (Vercel Edge vs. Upstash Redis) needs a quick spike at Phase 2 start.
- JWT TTL (15-minute starting point) may need a token-refresh pattern for long sessions — evaluate during Phase 2 smoke testing.

## Session Continuity

Last session: 2026-04-10
Stopped at: Roadmap created, STATE.md initialized, REQUIREMENTS.md traceability populated. Ready to run `/gsd-plan-phase 1`.
Resume file: None
