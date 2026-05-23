# Server-side memory injection (retire LUMO.md)

Date: 2026-05-22

## Problem

Memory accumulated across task sessions currently lives in two places:

- **`Memory` table** — the true source. Written directly by the `SubagentStop` → `layer1Service.triggerLayer1Extraction()` → `applyLayer1Operations()` pipeline. Each extraction inserts/updates/deletes `Memory` rows immediately.
- **`LUMO.md` in the repo** — a markdown mirror. Kept in sync by the `LumoProposal` review flow: user clicks "Apply" in the web UI, server walks the proposal's operations, rewrites `LUMO.md`, and opens a GitHub PR. `CLAUDE.md` does `@import LUMO.md`, so every Claude Code session loads it.

This is awkward:

1. Memory delivery to the agent depends on a manual, GitHub-mediated round-trip. The user has to click "Apply" and merge the PR before any new memory is visible to Claude.
2. `LUMO.md` is workspace-wide and undifferentiated — every session loads every task's traps/decisions, even when they're irrelevant.
3. Two write paths to "memory the agent sees" (DB and LUMO.md), with the second always lagging the first.

We want a single, server-driven injection path. The repo no longer hosts memory; the server injects task-scoped memory at session bind time and at session start.

## Goals

- `Memory` table is the sole source. No mirroring file.
- When a session is bound to a task, the agent gets that task's memory (plus project-scope memory) injected into the conversation.
- Cold-start session that already has a binding from a prior turn still gets memory injected via the SessionStart hook.
- A session with no task binding gets no memory (deliberate — keeps context clean).
- The local `LUMO.md` file, the `LumoProposal` review flow, and the GitHub-PR sync are removed entirely. No deprecation period — the data they carry (sync status) is not load-bearing once memory delivery moves server-side.

## Non-goals

- Adding a workspace-level memory scope. The `Memory` table stays TASK / PROJECT only. Project-scope memory still flows during binding (task's project is known); unbound sessions stay memory-less.
- Changing the layer1 extraction pipeline. Memory is still written by `SubagentStop`.
- Reworking `lumo task context`. It keeps its current shape — task description, memory section, previous sessions, unresolved. Its `memorySection` is the same renderer used by the new injection path.
- Migrating existing PENDING `LumoProposal` rows anywhere. They represent "not yet pushed to LUMO.md" — meaningless once LUMO.md is gone.

## Architecture

```
Memory (DB) ──┬── session-start hook → additionalContext → Claude (cold-start, already bound)
              └── bind-task API → CLI stdout → Claude (just-bound)
```

Both paths call the same renderer: `taskContextService.renderMemorySection(taskId)` (already exists; used today by `lumo task context`).

## Injection mechanism

### A. SessionStart hook

Route: `app/api/hooks/session-start/route.ts`

Currently returns `{ ok, sessionId, taskBinding }` with no memory text. Change:

- Look up the session row's `taskId`.
- If bound, call `renderMemorySection(taskId)` and embed the result in the response payload under the Claude Code hook's `additionalContext` field — the standard channel for injecting text into the session at start (the same channel the system prompt's "SessionStart hook additional context" tag wraps).
- If unbound, omit `additionalContext` (no fallback content).
- The route stays thin per CLAUDE.md's layered-architecture rule: build-additional-context lives in a helper inside the session service, not inline in the route.

### B. `session attach` CLI

Route: `app/api/sessions/[sessionId]/bind-task/route.ts`
CLI: `cli/src/commands/session-attach.ts`

After `sessionService.bindSessionToTask()` succeeds, call `renderMemorySection(taskId)` and add the result to the `BindResponse` as `memorySection?: string`.

The CLI prints memory immediately after its existing "Bound to LUM-N ..." line, separated by a markdown delimiter so it's readable as tool output. Claude Code sees this as Bash stdout and picks it up on the next turn.

If `memorySection` is empty (task has no memory yet), the CLI prints the existing "Bound to LUM-N ..." line and nothing else — no placeholder text. Empty injection is silent injection; we don't want Claude to read "no memory" and conclude the task has no context (it may have description / previous sessions visible via `task context`).

## Removed surface

Items removed in the same change set (deletion-only PR or grouped with the new injection):

**Frontend**
- `components/AgentRunTimeline/SyncLumoBanner.tsx`
- The "Apply / Preview" dialog opened by that banner
- Any `unsyncedMemoryCount` calculation in `getTimeline` and any consumers of that field

**API routes**
- `app/api/tasks/[id]/lumo-proposals/`
- `app/api/lumo-proposals/[proposalId]/sync/`
- `app/api/lumo-proposals/[proposalId]/dismiss/`

**Services & libs**
- `lib/services/lumo-proposal/` (entire directory)
- `lib/services/lumo-sync/` (entire directory)
- octokit calls used **only** by lumo-sync. Octokit calls for unrelated GitHub features (PR-link rendering, Slack integration, etc.) stay.
- The `Memory` → LUMO.md operations renderer that lives inside `lumo-sync` (lines 101 in the survey). Distinct from `renderMemorySection` (markdown for agents); these go.

**Prisma**
- `model LumoProposal { ... }` (schema.prisma:1303-1322)
- `enum LumoProposalStatus { ... }`
- A new migration `<timestamp>_drop_lumo_proposal` that drops the table and enum.

**Repo files**
- `LUMO.md` (root)
- The `@import LUMO.md` line in `CLAUDE.md`

## Data migration

- `LumoProposal` rows are dropped with the table. They are not migrated — the `operations` JSON they hold has already been applied to `Memory` rows at extraction time (the proposal is only a "sync state" record for the GitHub mirror, which no longer exists).
- The migration is destructive (DROP TABLE + DROP ENUM). The PR description must call this out: "requires `prisma migrate deploy` on next deploy; drops `LumoProposal` table — proposal history is not preserved."
- Deploy order: merge code that no longer reads/writes `LumoProposal` → next prod deploy runs `migrate deploy` → table goes away. Code-then-schema, never schema-first.

## Behavior contract (what agents see)

| Scenario | Memory injected? | Channel |
|----------|-----------------|---------|
| New `claude code` session, no prior binding | No | — |
| `lumo session attach LUM-42` in active session | Yes | CLI stdout |
| Existing session restarted, `Session.taskId` already set | Yes | SessionStart hook `additionalContext` |
| `lumo session attach LUM-99` switching from LUM-42 in active session | Yes, LUM-99's memory | CLI stdout (server overwrites `Session.taskId`, returns new memory) |
| `lumo session detach` | No (binding cleared, no further injection) | — |
| Bound task has zero memory rows | No `memorySection` printed; no `additionalContext` block | both |

## Renderer contract

`taskContextService.renderMemorySection(taskId)` must:

- Take a task ID and return a string. Empty string (`""`) — not `undefined` — when the task has no memory rows. Callers check for empty string to decide whether to omit the block.
- Take only that task ID as input. Must not require `previousSessions`, `unresolvedItems`, or other fields from the surrounding `task context` payload. If it currently does, extract a thinner version that takes `taskId` alone.
- Internally pull both TASK-scope memory for `taskId` and PROJECT-scope memory for the task's project — matching today's `task context` output (`findActiveTaskMemories` + `findActiveProjectMemories`).

Verify the current signature during plan-writing; if it's not standalone, the refactor is part of the implementation.

## Out-of-scope follow-ups

- Memory size cap / truncation: if a task accrues hundreds of memory rows, the injected block could bloat the conversation. Not addressed here; revisit if seen in practice.
- Workspace-scope memory: punted (see Non-goals).
- A web UI replacement for "see what memory exists for this task": deferred. The task-detail page already shows memory; if it doesn't, that's a follow-up task, not this design.
- Audit log of memory mutations: not preserved by dropping `LumoProposal`. If we later want history, we'll add an explicit `MemoryEvent` table — not part of this change.

## Open questions

None blocking. Items to confirm during plan-writing:

- Confirm `taskContextService.renderMemorySection` is exported and reusable as-is, or note refactor needed.
- Confirm the exact JSON shape Claude Code expects in the SessionStart hook for `additionalContext` (the system prompt's tag confirms the mechanism but not the wire format — verify against Claude Code's hook docs before plan finalization).
