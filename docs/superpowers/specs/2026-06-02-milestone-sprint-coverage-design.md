# Milestone ↔ Sprint Coverage (read-only) — Design

**Task:** LUM-164 — [探索] Milestone ↔ Sprint 关联
**Date:** 2026-06-02
**Status:** Approved design, pending spec review

## Background

The current schema keeps `Milestone` and `Sprint` completely independent:

- `Milestone` is scoped to a **Project** (`Milestone.projectId`).
- `Sprint` is scoped to a **Team** (`Sprint.teamId`).
- The only connection point between them is the **Task**, which carries both
  `milestoneId` (project-scoped) and `sprintId` (team-scoped) — see
  `prisma/schema.prisma:423-424`.

The exploration (LUM-164) confirmed the real need is **read-only**: "see which
sprints a milestone spans, and the progress per sprint." This relationship is
**derivable today** by aggregating the milestone's tasks by `sprintId` — **no
new relation, no migration**.

Decision (chosen over a stored `Milestone↔Sprint` FK/join table): derive the
coverage at query time. A stored relation was rejected as over-design for a
small team and because Sprint (team-scoped) vs Milestone (project-scoped) live
in different scoping hierarchies, which would require extra cross-scope validity
rules.

## Goal

On a single milestone's detail, show a **Sprint coverage** view:

- Which sprints the milestone's tasks span (sprint number, name, status).
- Per-sprint progress as `done / total`.
- A count of milestone tasks not assigned to any sprint ("未排期").

Surfaces: **CLI `lumo milestone show`** and the **Web milestone detail page**.

Non-goals: assigning a milestone to a sprint as a planning action; any write
path; any schema change; per-status breakdown beyond `done/total`.

## Architecture

Data flow follows the existing layered pattern
(`Component / CLI → API Route → Service → Repository → Prisma`). Coverage is
computed **once, server-side**, and enriched onto the existing milestone detail
response — mirroring how `taskCounts` and `health` are already enriched
(`app/api/milestones/[milestoneId]/route.ts:23-25`). Both CLI and Web consume
the same field; no client-side aggregation.

### Data shape (API)

Added to the milestone detail response (`{ milestone: ApiMilestone }`):

```ts
sprintCoverage: {
  sprints: Array<{
    sprintId: string
    number: number
    name: string
    status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
    taskCount: number // tasks in this milestone AND this sprint
    doneCount: number // of those, status === DONE
  }> // sorted by sprint number ascending
  unsprinted: number // milestone tasks with sprintId === null
}
```

When the milestone has no tasks at all: `{ sprints: [], unsprinted: 0 }`.

## Components

### ① Repository

**`lib/repositories/milestone.repository.ts` — new `sprintCoverageCounts(milestoneId)`**

Mirrors the existing `countTasksByStatus` groupBy pattern
(`milestone.repository.ts:126-142`). Aggregates without loading full task rows:

```ts
prisma.task.groupBy({
  by: ['sprintId', 'status'],
  where: { milestoneId },
  _count: { _all: true },
})
```

Returns rows of `{ sprintId: string | null, status: TaskStatus, _count }`.

**`lib/repositories/sprint.repository.ts` — new `findByIds(sprintIds, teamId?)`**

```ts
prisma.sprint.findMany({
  where: { id: { in: sprintIds }, ...(teamId ? { teamId } : {}) },
  select: { id: true, number: true, name: true, status: true },
})
```

`teamId` is a defensive scope guard (the sprintIds already come from the
milestone's own tasks, which all share the milestone's project → one team, so
they are inherently in-team; the guard is belt-and-suspenders). Empty input
returns `[]` without a query.

### ② Service

**`lib/services/milestone.service.ts`**

- Pure helper `computeSprintCoverage(counts, sprints)` — joins the groupBy rows
  with sprint metadata, buckets `sprintId === null` rows into `unsprinted`, sums
  `taskCount`/`doneCount` per sprint, drops any sprint with zero tasks, and
  sorts by `number` asc. Pure and deterministic → unit-testable in isolation.
- A method (e.g. `getSprintCoverage(milestoneId, teamId)`) that calls
  `sprintCoverageCounts`, collects distinct non-null sprintIds, fetches metadata
  via `sprintRepository.findByIds`, and returns `computeSprintCoverage(...)`.

### ③ API Route

**`app/api/milestones/[milestoneId]/route.ts`** — call the service method and
add `sprintCoverage` to the `{ milestone }` payload, alongside the existing
`taskCounts` and `health` enrichment. Route stays thin (no Prisma, no logic).

### ④ CLI

**`cli/src/commands/milestone-show.ts`**

- Extend `MilestoneShowData` with the `sprintCoverage` field (already fetched —
  `milestone show` already calls `GET /api/milestones/[id]`, so no extra
  request).
- In `formatMilestoneShow()`, insert a section **before** the task table:

```
Sprint coverage:
  #3  ACTIVE  Sprint 3   4/6 done
  #4  DRAFT   Sprint 4   0/2 done
  未排期                  1 task
```

- When `sprints` is empty: print `Sprint coverage: (no sprint coverage)`.
- The `未排期` line is shown only when `unsprinted > 0`.
- Sprint `name` is server-returned free text → wrap in `sanitizeField()` before
  stdout (per the CLI untrusted-output rule).

### ⑤ Web

**`app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`**

- Add `sprintCoverage` to `ApiMilestone` in `lib/api-client/milestones.ts`
  (after `health`). It arrives automatically through the existing
  `useMilestone` / `useMilestoneByProjectAndSlug` react-query hooks.
- Extract a new presentational child `<MilestoneSprintCoverage coverage={...} />`
  (SRP — own file under `components/milestones/`), rendered between the
  description block and `<TaskListByMilestone />`.
- Each row: sprint `#number` + name + status badge + progress `4/6`. Reuse the
  status-badge pattern from `sprints/components/SprintSidebar.tsx:38-49`
  (`rounded-full px-2 py-0.5 text-xs font-medium` + per-status color map). A
  muted trailing line shows "未排期: N" when `unsprinted > 0`.
- Empty state: a muted "No sprints covered" line.

### ⑥ i18n

Add to **all 17** locale files in `lib/i18n/` (proper translation per locale —
no English fallback), following the `milestone.*` key pattern:

- `milestone.sprintCoverage.title` → "Sprint coverage"
- `milestone.sprintCoverage.empty` → "No sprints covered"
- `milestone.sprintCoverage.unsprinted` → "{count} unsprinted" (or localized)
- `milestone.sprintCoverage.progress` → "{done}/{total}"

Sprint status labels: reuse existing sprint status i18n keys if present;
otherwise add minimal `DRAFT/ACTIVE/CLOSED` labels in the same files.

### ⑦ Tests (Jest)

- `computeSprintCoverage` unit tests: grouping + counting, `done/total` math,
  the `unsprinted` bucket, zero-task / no-sprint empty cases, sort-by-number.
- CLI formatter test for the new `Sprint coverage` section (populated, empty,
  and `unsprinted === 0` variants).

### ⑧ Docs

Update `.claude/skills/lumo/SKILL.md` `milestone show` section to document the
new Sprint coverage output (CLAUDE.md mandates SKILL.md sync when CLI command
output changes).

## Scope / cross-team safety

All tasks in a milestone belong to one project → one team, so every aggregated
`sprintId` is in that team. `findByIds` additionally scopes by `teamId` as a
defensive guard. No cross-team data can leak.

## Files touched

- `lib/repositories/milestone.repository.ts` (new method)
- `lib/repositories/sprint.repository.ts` (new `findByIds`)
- `lib/services/milestone.service.ts` (pure helper + method)
- `app/api/milestones/[milestoneId]/route.ts` (enrich response)
- `lib/api-client/milestones.ts` (type field)
- `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx` (render)
- `app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage.tsx` (new)
- `cli/src/commands/milestone-show.ts` (type + formatter section)
- `lib/i18n/*.json` (17 files)
- `.claude/skills/lumo/SKILL.md` (docs sync)
- `__tests__/` (service + CLI formatter tests)

No migration. No new npm package.
