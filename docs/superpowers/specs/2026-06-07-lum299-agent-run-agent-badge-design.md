# Design — Agent identity badge per run on the "Agent 运行" tab

- **Task:** LUM-299
- **Date:** 2026-06-07
- **Branch:** `lumo/LUM-299-agent-badge`

## Problem

The "Agent 运行" (Agent Run) tab on the task detail page lists each run as
`Run #N` with a start timestamp, duration, tool-call count, and memory count.
It does **not** show *which* coding agent produced the run. As Lumo grows to
support more than one CLI (Codex, Cursor, Gemini CLI, GitHub Copilot, Windsurf
in addition to Claude Code), a user looking at the history cannot tell at a
glance which agent did which run.

## Goal

Render a small **icon + label** badge on each run row identifying the agent
(e.g. `✦ Claude Code`), reusing the existing brand-icon badge component.

## Key finding — the data is already there

Despite the name, each `Run #N` row on this tab **is a `Session`**, not an
`AgentRun`. The timeline service builds runs from `sessionRepository.listForTask`
([lib/services/agent-run-timeline.service.ts](../../../lib/services/agent-run-timeline.service.ts)),
and the `Session` model **already has an `agent` field**
(`TaskArtifactAgent` enum: `CLAUDE_CODE | CODEX | CURSOR | GEMINI_CLI |
GITHUB_COPILOT | WINDSURF`), set once on session create from the CLI's
`X-Lumo-Agent` header and defaulting to `CLAUDE_CODE`.

A ready-made badge component also exists:
[`AgentBadge`](../../../app/workspace/[workspaceUrl]/components/AgentBadge.tsx)
renders the `@lobehub/icons` brand glyph + a localized label, with a `safeAgent`
coercion guard and `taskArtifact.agent.*` i18n keys already present across all
16 locales (it's used elsewhere today).

So this feature is **pure pass-through + reuse**: thread `Session.agent` from
the repository through the service and wire types to the existing badge. **No
schema change, no migration, no new i18n keys.**

## Decisions

1. **Display form:** icon + text, by reusing `<AgentBadge agent={…} />`.
2. **Orphan / "Unlinked" run** (the trailing bucket with `sessionId === null`,
   built from hook events whose session never linked): **fall back to
   `CLAUDE_CODE`**. This keeps `AgentRunSession.agent` a non-nullable
   `TaskArtifactAgent` and means every row renders a badge. (The orphan bucket
   has no Session row, hence no real agent; `CLAUDE_CODE` is the accurate
   default today since only Claude Code emits hooks.)
3. **Scope:** standalone task (LUM-299), separate branch/PR from LUM-298
   (per-run token cost), even though both touch the same tab.

## Changes (4 layers, bottom-up)

| Layer | File | Change |
| --- | --- | --- |
| Repository | `lib/repositories/session.repository.ts` → `listForTask` | Add `agent: true` to the `select`. |
| Service | `lib/services/agent-run-timeline.service.ts` | Add `agent: TaskArtifactAgent` to the `AgentRunSession` interface; populate `agent: s.agent` in the per-session map; set `agent: 'CLAUDE_CODE'` on the orphan bucket. |
| Frontend type | `app/workspace/[workspaceUrl]/types.ts` → `AgentRunSession` | Add the matching `agent: TaskArtifactAgent` field. |
| Component | `app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard.tsx` | Render `<AgentBadge agent={run.agent} />` in the run header row, next to the start-time label. |

The two `AgentRunSession` interfaces (service wire-type and frontend type) are
intentionally separate copies today; both must gain the field to stay in sync.

## Non-goals

- No `agent` field on the `AgentRun` model (that model is not what this tab
  renders; out of scope).
- No backfill: existing sessions already carry `agent` (defaulted to
  `CLAUDE_CODE` where the header was absent), so nothing to migrate.
- No change to how `Session.agent` is captured (the `X-Lumo-Agent` ingestion
  path is unchanged).

## Known limitation (honest caveat)

Today **every** session resolves to `CLAUDE_CODE` because only Claude Code
currently emits hook events with the `X-Lumo-Agent` header. So the badge will
show "Claude Code" on every row until other CLIs integrate hook reporting. This
is intentionally **forward-looking**: the wiring is correct now and other agents
light up automatically once they report.

## Testing

- **Service unit test** (`__tests__/lib/services/agent-run-timeline.service.test.ts`
  or wherever the existing suite lives): assert `agent` is passed through from a
  session row to its `AgentRunSession`, and that the orphan/unlinked bucket gets
  `CLAUDE_CODE`.
- **Repository:** covered indirectly; the `select` addition is exercised by the
  service test via the mocked repo. If the existing repo test asserts the exact
  `select` shape, update it to include `agent: true`.
- Component rendering is not load-bearing for logic; no new component test
  required (jsdom would just render the badge).

## Verification

- `npx tsc --noEmit` (from the worktree) — both `AgentRunSession` copies in sync.
- `npx jest` for the timeline service suite (run from inside the worktree).
- `npm run i18n:check` — confirm no new keys needed (expect clean).
