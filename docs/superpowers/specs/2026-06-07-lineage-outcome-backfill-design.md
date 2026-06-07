# LUM-296 — Backfill lineage outcomes: stamp at edge-birth when task already terminal + poller sweep

**Status:** design approved
**Date:** 2026-06-07
**Milestone:** Context Lineage (System of Record)

## Problem

Outcome stamping (LUM-277, `lineage-outcome.service.ts → stampOutcomeByTask`) is
purely **event-forward triggered**: a PR webhook reaching `merged`/`closed`, a
task transitioning to `DONE`, or a task `reopen`. Each trigger stamps the task's
lineage edges *at the moment the transition happens*.

In production, **100% of edges are born *after* their terminal event**
(measured: `edges_born_AFTER_merge = 546`, `born_before = 0`). Edges are born at
session-start; by then the related PR is long-merged and the task long-DONE. The
transition that would stamp them already fired — before the edge existed — and
will not fire again. Result: 546 self-generated edges, `stamped = 0`,
`merged = 0`, despite 382 merged PRs and all 5 edge-bearing tasks
(LUM-179/263/267/258/235) being DONE. The LUM-278 flywheel renders no signal
(0 MERGED → cold-start gate swallows everything).

What is missing is a **birth-time backfill** plus a **resident self-heal sweep**.

## Decisions

- **Terminal-success criterion:** `task.status === 'DONE'` → `MERGED`. Only this.
  - Covers all 5 prod tasks (all DONE) and the 546 edges.
  - A reopened-after-merge task has `status != 'DONE'`, so it is naturally
    excluded — rework-session edges correctly stay UNKNOWN until the task is
    DONE again. (A merged PR drives a task to DONE in Lumo's model, so the
    `mergedAt`-based criterion from the ticket adds no coverage but does
    introduce the reopen ambiguity; we drop it.)
  - REWORKED is doubly protected: reopened tasks are excluded by the status
    filter, and `stampOutcomeByTask(MERGED)` never targets REWORKED (it is not
    in `STAMPABLE_FROM.MERGED`).
- **Backfill mechanism:** a single Vercel cron that does both jobs. Its first
  run backfills the existing 546; every subsequent run is the resident
  self-heal sweep. No separate one-off script.
- **No schema change:** reads `task.status`, writes the existing `outcome`
  column. No migration.

## Components

### 1. Birth-time stamp — `lib/services/lineage.service.ts::recordSessionStartEdges`

After `createMany`, look up the task's status; if `=== 'DONE'`, call
`lineageEdgeRepository.stampOutcomeByTask(taskId, 'MERGED')`. Stays inside the
method's existing `try/catch` (best-effort — must never affect context
injection). Requires a lightweight status read
(`taskRepository.getStatus(taskId)` or `prisma.task.findUnique({ select: { status: true } })`).

### 2. Sweep repository method — `lib/repositories/lineage-edge.repository.ts`

New `stampDoneTaskEdges()`: a single relation-filtered `updateMany`:

```ts
prisma.lineageEdge.updateMany({
  where: { outcome: { in: STAMPABLE_FROM.MERGED }, task: { status: 'DONE' } },
  data: { outcome: 'MERGED' },
})
```

Reuses the existing `STAMPABLE_FROM['MERGED'] = ['UNKNOWN', 'REJECTED']` constant
(single source of truth for the monotonic ladder); REWORKED is not in the set,
so it is left untouched. System-wide scan (no workspace filter — the cron is a
system job). Returns `{ count }`.

### 3. Cron route — `app/api/cron/backfill-lineage-outcomes/route.ts` + `vercel.json`

`GET` guarded by `Bearer ${CRON_SECRET}` (mirrors
`app/api/cron/prune-document-revisions`). Calls a service method
`lineageOutcomeService.sweepDoneTaskEdges()` (route stays thin, does not touch
the repository directly — CLAUDE.md layering). Schedule: `0 * * * *` (hourly,
same cadence as `check-agent-timeouts`). First post-deploy run backfills the 546.

## Data flow

- **Birth:** session-start → `recordSessionStartEdges` → `createMany` →
  (status DONE?) `stampOutcomeByTask(taskId, 'MERGED')`
- **Self-heal:** cron (hourly) → `lineageOutcomeService.sweepDoneTaskEdges()` →
  `lineageEdgeRepository.stampDoneTaskEdges()` → `updateMany`

## Error handling

- Birth-time: already inside `recordSessionStartEdges`'s try/catch (logged and
  swallowed).
- Cron: standard route pattern — service error → 500. The sweep is a single
  idempotent `updateMany`, safe to re-run.

## Testing

The existing 85 lineage tests mock Prisma and only verify event-forward
triggering — they never exercise backfill. This task's core deliverable is
covering the **"edge born after merge"** scenario.

- `recordSessionStartEdges`:
  - task is DONE → new edges stamped MERGED after birth
  - task is not DONE → edges stay UNKNOWN
  - task with existing REWORKED edges + a new UNKNOWN edge → REWORKED unchanged
    (and new edge stamped only if status is DONE)
- `stampDoneTaskEdges` (repo) / `sweepDoneTaskEdges` (service):
  - UNKNOWN + DONE → MERGED
  - UNKNOWN + not-DONE → unchanged
  - REWORKED + DONE → stays REWORKED
  - REJECTED + DONE → MERGED
- cron route: rejects without `CRON_SECRET` (401), succeeds with it (200).

Follow the existing lineage test style (confirm mock-Prisma vs real-DB before
writing).

## Acceptance (DoD)

- After backfill, `lumo task lineage LUM-263` is no longer all-UNKNOWN.
- `lumo task context` renders a merge-rate signal for fragments with merged
  history.
- New tests cover the born-after-merge path.

## Out of scope (deliberately deferred)

True causality (controlled re-runs, v2), lineage-aware ranking/trimming, billing
UI, delete/GDPR propagation (tracked as known debt).
