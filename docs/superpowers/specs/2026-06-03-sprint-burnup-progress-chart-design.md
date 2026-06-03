# Sprint Progress Chart (Burnup) — Design [LUM-169]

**Date**: 2026-06-03
**Status**: Approved design, pending implementation plan
**Supersedes**: the daily-remaining burndown shipped in #244 / fixed in #255

## Problem

LUM-169 originally shipped a **burndown** chart: one `remaining` line = count of
in-sprint, not-DONE tasks sampled at each day's 24:00, plus an ideal line.

Real production data (Sprint 4) proved it useless. The team is agent-heavy:
tasks are created → added to a sprint → completed often within the **same day**.
Any 24:00 "remaining" snapshot misses them entirely.

Sprint 4 evidence (54 tasks, current state `DONE: 53, IN_REVIEW: 1`):

| metric | meaning | 06-01 | 06-02 | 06-03 |
| --- | --- | --- | --- | --- |
| `remaining` (burndown) | in-sprint ∧ ≠DONE @ EOD | 1 | 2 | 1 |
| `scopeJoin` | in-sprint @ EOD | 3 | 4 | 54 |
| `scopeCreate` | candidate created by EOD | 29 | 40 | 54 |
| `compEvent` | candidate DONE @ EOD | 19 | 33 | 53 |
| `compSnap` | in-sprint ∧ DONE @ EOD | 2 | 2 | 53 |

The burndown line `[1, 2, 1]` against an ideal of 54 is degenerate. 53 of 54
completed tasks are invisible to it.

**Tests being green (16/16) did not prove the feature worked** — the tests
covered cross-day cases; real data is the same-day case. This is the core lesson
and the reason real-data validation is a hard delivery gate (see Testing).

## Decision

Replace the burndown with a **burnup** (Linear-style "Progress" chart): two
cumulative lines that go **up**, plus a projection. Reconstructed from the same
`TaskActivity` stream. **No schema change.**

### Model (confirmed: "Pairing X" — event/creation time)

Candidate set `C` = tasks ever in the sprint (currently in sprint ∪ tasks with a
`SPRINT_CHANGED` whose payload `from`/`to` references this sprint) — unchanged
from the burndown repository.

For each sampled day, at end-of-day `T`:

- **`scope(T)`** = `|{ t ∈ C : t.createdAt ≤ T }|` — committed work known by `T`.
- **`completed(T)`** = `|{ t ∈ C : statusAt(t, T) === 'DONE' }|` — done by `T`.

Why Pairing X (vs the membership-snapshot "Pairing Y" = `scopeJoin`/`compSnap`):

- The only two **self-consistent** pairings are X (`scopeCreate`/`compEvent`,
  smooth: `[29,40,54]` / `[19,33,53]`) and Y (`scopeJoin`/`compSnap`, cliff:
  `[3,4,54]` / `[2,2,53]`). Mixing membership-scope with event-completed breaks
  the chart (`completed > scope`, e.g. 19 > 3).
- X always satisfies the invariant **`completed(T) ≤ scope(T)`** (a task can't be
  done before it's created).
- X degrades gracefully on the agent-heavy "do-then-bucket" pattern AND on a
  normal sprint (tasks committed up front, completed over the iteration) where X
  and Y look the same. Y produces a near-empty two days + a cliff on Sprint 4.

### Projection

- Window starts at `startedAt ?? startDate` (keeps the #255 fix; drops pre-start
  empty days).
- **ACTIVE**: `completed`/`scope` actual values run up to "today"; future days
  get `completed = null`, `scope` held flat at its current value. A dashed
  **`projected`** line runs from today's `completed` point straight to
  `(endDate, scopeTotal)` — "will we burn the scope down by the deadline?"
- **CLOSED**: all days are past; `completed` runs to `end`; **no projection**.

`completed` uses `statusAt` (last status event ≤ T), so a re-open (DONE→TODO)
makes the line dip — correct, and it stays ≤ scope.

## Data shapes

```ts
interface BurnupPoint {
  date: string                 // UTC YYYY-MM-DD
  scope: number                // committed work known by EOD
  completed: number | null     // done by EOD; null for future days (ACTIVE)
  projected: number | null     // projection segment only; null elsewhere
}
interface BurnupSeries {
  sprintId: string
  start: string
  end: string
  unit: 'tasks'
  scopeTotal: number           // final scope = y-axis max
  series: BurnupPoint[]
}
```

## Architecture / layers

Reuse the existing chain — only semantics and the response shape change. Route
stays thin; Prisma stays in the repository.

`Component → api-client → API route → service → repository → Prisma`

### File-by-file (rename + rewrite; burndown removed, not kept alongside)

| Remove / from | Add / to | Note |
| --- | --- | --- |
| `lib/services/sprint-burndown.ts` (`computeBurndownSeries`) | `lib/services/sprint-burnup.ts` (`computeBurnupSeries`) | pure fn, the primary surface |
| `lib/services/sprint-burndown.service.ts` | `lib/services/sprint-burnup.service.ts` | passes `startedAt`, `createdAt` through |
| `lib/repositories/sprint-burndown.repository.ts` | `lib/repositories/sprint-burnup.repository.ts` | task `select` adds `createdAt: true` |
| `app/api/sprints/[id]/burndown/route.ts` | `app/api/sprints/[id]/burnup/route.ts` | otherwise identical (auth → service) |
| api-client `getBurndown` / `SprintBurndownResponse` | `getBurnup` / `SprintBurnupResponse` | |
| `constants.ts` `API.sprints.burndown` | `API.sprints.burnup` | |
| `query/keys.ts` `sprints.burndown` | `sprints.burnup` | |
| `useSprints.ts` `useSprintBurndown` | `useSprintBurnup` | |
| `SprintBurndownChart.tsx` | `SprintProgressChart.tsx` | |
| `SprintDetailClient.tsx` import + render | swap to `SprintProgressChart` | |
| i18n `sprint.burndown.*` | `sprint.burnup.*` | **every** locale file |
| `__tests__/sprint-burndown.test.ts` | `__tests__/sprint-burnup.test.ts` | |

## UI (hand-written SVG, Linear-inspired but restrained)

- **Scope**: grey solid (`muted-foreground`). **Completed**: `primary` solid,
  optional faint fill below (`primary/10`). **Projected**: `primary` dashed.
- **Two colors only** (per the "order via typography, not color" rule): grey +
  primary. Projection is the same primary, just dashed.
- y-axis max = `scopeTotal`. Legend: 范围 / 完成 / 预测 (Scope / Completed /
  Projected).
- Empty state when `scopeTotal === 0`.

## Testing

Primary surface = the pure `computeBurnupSeries`. Cases:

1. Smooth burnup: scope and completed both rise; values match a hand-computed
   fixture.
2. Invariant `completed ≤ scope` at every point.
3. Projection geometry: ACTIVE sprint, `projected` linear from today's
   `completed` to `(end, scopeTotal)`; non-null only on the projection segment.
4. ACTIVE future days: `completed === null`, `scope` flat.
5. CLOSED sprint: no projection; `completed` runs to `end`.
6. Re-open (DONE→TODO) makes `completed` dip and stay ≤ scope.
7. `startedAt` anchoring: pre-`startedAt` days dropped.
8. Empty sprint: `scopeTotal === 0`, empty series handling.

**Hard delivery gate (not committed):** before flipping LUM-169 to done, re-run
the burnup against **prod Sprint 4** real data and confirm the curves are
meaningful (scope `[29,40,54]`, completed `[19,33,53]`). Green unit tests alone
do not close this task.

## Accepted simplifications (documented, not bugs)

- Counts candidates completed **before** they joined the sprint (matches the
  "execute-then-bucket" workflow, but is not strictly "completed inside the
  sprint window").
- Scope does **not** shrink when a task is removed from the sprint (the candidate
  set still contains it). Most sprints don't remove tasks; acceptable for MVP.

## Out of scope (YAGNI)

- A `Started` (cumulative in-progress) line — agent-heavy tasks often skip
  IN_PROGRESS; add only if real data shows it carries signal.
- Workload/story-point burnup — depends on estimation fields (separate task).
- Schema changes — none.
