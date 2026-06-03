# Milestone ↔ Sprint Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, read-only, which sprints a milestone's tasks span and the per-sprint `done/total` progress — in both the `lumo milestone show` CLI and the Web milestone detail page.

**Architecture:** The Milestone↔Sprint relationship is derived (no schema change) by aggregating the milestone's tasks on `(sprintId, status)` via a single Prisma `groupBy`. Aggregation is computed once server-side in a pure helper, orchestrated by a service method, and enriched onto the existing `GET /api/milestones/[id]` response next to `taskCounts`/`health`. CLI and Web both render the same `sprintCoverage` field; neither aggregates client-side.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma, Jest (SWC, mocks Prisma), react-intl, Tailwind/shadcn.

---

## File Structure

| File                                                                             | Responsibility                                                                                     | New/Modify                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------- |
| `lib/summaries/sprint-coverage.ts`                                               | Pure helper `computeSprintCoverage` + exported types (mirrors `lib/summaries/milestone-health.ts`) | Create                       |
| `lib/repositories/milestone.repository.ts`                                       | `sprintCoverageCounts(milestoneId)` groupBy                                                        | Modify                       |
| `lib/repositories/sprint.repository.ts`                                          | `findByIds(sprintIds, teamId?)` bulk metadata                                                      | Modify                       |
| `lib/services/milestone.service.ts`                                              | `getSprintCoverage(milestoneId, memberId)` orchestration                                           | Modify                       |
| `app/api/milestones/[milestoneId]/route.ts`                                      | enrich GET response with `sprintCoverage`                                                          | Modify                       |
| `lib/api-client/milestones.ts`                                                   | `sprintCoverage` field on `ApiMilestone`                                                           | Modify                       |
| `cli/src/commands/milestone-show.ts`                                             | type + `Sprint coverage` formatter section                                                         | Modify                       |
| `app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage.tsx` | presentational coverage block                                                                      | Create                       |
| `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`          | render `<MilestoneSprintCoverage/>`                                                                | Modify                       |
| `lib/i18n/*.json` (16 files)                                                     | `milestone.sprintCoverage.*` keys                                                                  | Modify                       |
| `.claude/skills/lumo/SKILL.md`                                                   | document new CLI output                                                                            | Modify                       |
| `__tests__/summaries/sprint-coverage.test.ts`                                    | pure helper tests                                                                                  | Create                       |
| `__tests__/milestone.repository.sprint-coverage.test.ts`                         | repo groupBy test                                                                                  | Create                       |
| `__tests__/milestone.service.sprint-coverage.test.ts`                            | service orchestration test                                                                         | Create                       |
| `__tests__/api-milestone-get.test.ts`                                            | extend: assert `sprintCoverage` in response                                                        | Modify                       |
| `cli/__tests__/milestone-show.test.ts`                                           | formatter section test                                                                             | Create (or extend if exists) |
| `__tests__/components/MilestoneSprintCoverage.test.tsx`                          | jsdom render test                                                                                  | Create                       |

**Note on placement:** the spec said the pure helper could live in `milestone.service.ts`; this plan instead puts it in `lib/summaries/sprint-coverage.ts` to mirror the existing `lib/summaries/milestone-health.ts` pattern (pure, separately testable). The service method stays in `milestone.service.ts`.

---

## Task 1: Pure helper `computeSprintCoverage`

**Files:**

- Create: `lib/summaries/sprint-coverage.ts`
- Test: `__tests__/summaries/sprint-coverage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/summaries/sprint-coverage.test.ts`:

```ts
import {
  computeSprintCoverage,
  type SprintCoverageCountRow,
  type SprintMeta,
} from '@/lib/summaries/sprint-coverage'

const sprints: SprintMeta[] = [
  { id: 's2', number: 2, name: 'Sprint 2', status: 'CLOSED' },
  { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
]

describe('computeSprintCoverage', () => {
  it('groups counts per sprint with done/total and sorts by number asc', () => {
    const counts: SprintCoverageCountRow[] = [
      { sprintId: 's3', status: 'DONE', count: 4 },
      { sprintId: 's3', status: 'TODO', count: 2 },
      { sprintId: 's2', status: 'DONE', count: 1 },
      { sprintId: 's2', status: 'IN_REVIEW', count: 1 },
    ]
    const result = computeSprintCoverage(counts, sprints)
    expect(result.sprints).toEqual([
      {
        sprintId: 's2',
        number: 2,
        name: 'Sprint 2',
        status: 'CLOSED',
        taskCount: 2,
        doneCount: 1,
      },
      {
        sprintId: 's3',
        number: 3,
        name: 'Sprint 3',
        status: 'ACTIVE',
        taskCount: 6,
        doneCount: 4,
      },
    ])
    expect(result.unsprinted).toBe(0)
  })

  it('buckets sprintId === null into unsprinted', () => {
    const counts: SprintCoverageCountRow[] = [
      { sprintId: null, status: 'TODO', count: 3 },
      { sprintId: null, status: 'DONE', count: 1 },
      { sprintId: 's3', status: 'TODO', count: 1 },
    ]
    const result = computeSprintCoverage(counts, sprints)
    expect(result.unsprinted).toBe(4)
    expect(result.sprints).toHaveLength(1)
    expect(result.sprints[0]).toMatchObject({
      sprintId: 's3',
      taskCount: 1,
      doneCount: 0,
    })
  })

  it('drops sprints with zero tasks and ignores counts for unknown sprints', () => {
    const counts: SprintCoverageCountRow[] = [
      { sprintId: 's3', status: 'TODO', count: 1 },
      { sprintId: 'gone', status: 'TODO', count: 9 },
    ]
    const result = computeSprintCoverage(counts, sprints)
    expect(result.sprints.map(s => s.sprintId)).toEqual(['s3'])
  })

  it('returns empty coverage when there are no tasks', () => {
    expect(computeSprintCoverage([], sprints)).toEqual({
      sprints: [],
      unsprinted: 0,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/summaries/sprint-coverage.test.ts`
Expected: FAIL — `Cannot find module '@/lib/summaries/sprint-coverage'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/summaries/sprint-coverage.ts`:

```ts
import type { SprintStatus, TaskStatus } from '@prisma/client'

/** One `(sprintId, status)` aggregation row from the repository groupBy. */
export interface SprintCoverageCountRow {
  sprintId: string | null
  status: TaskStatus
  count: number
}

/** Minimal sprint metadata needed to render a coverage row. */
export interface SprintMeta {
  id: string
  number: number
  name: string
  status: SprintStatus
}

export interface SprintCoverageEntry {
  sprintId: string
  number: number
  name: string
  status: SprintStatus
  taskCount: number
  doneCount: number
}

export interface SprintCoverage {
  /** Covered sprints, sorted by sprint number ascending. */
  sprints: SprintCoverageEntry[]
  /** Count of milestone tasks with no sprint binding. */
  unsprinted: number
}

/**
 * Derive a milestone's sprint coverage from `(sprintId, status)` task counts.
 * Pure and deterministic. `sprintId === null` rows accumulate into `unsprinted`.
 * Counts referencing a sprint absent from `sprints` are ignored. Sprints with
 * no tasks are dropped from the output.
 */
export function computeSprintCoverage(
  counts: SprintCoverageCountRow[],
  sprints: SprintMeta[]
): SprintCoverage {
  const metaById = new Map(sprints.map(s => [s.id, s]))
  const acc = new Map<string, { taskCount: number; doneCount: number }>()
  let unsprinted = 0

  for (const row of counts) {
    if (row.sprintId === null) {
      unsprinted += row.count
      continue
    }
    if (!metaById.has(row.sprintId)) continue
    const entry = acc.get(row.sprintId) ?? { taskCount: 0, doneCount: 0 }
    entry.taskCount += row.count
    if (row.status === 'DONE') entry.doneCount += row.count
    acc.set(row.sprintId, entry)
  }

  const result: SprintCoverageEntry[] = []
  for (const [sprintId, sums] of acc) {
    const meta = metaById.get(sprintId)!
    result.push({
      sprintId,
      number: meta.number,
      name: meta.name,
      status: meta.status,
      taskCount: sums.taskCount,
      doneCount: sums.doneCount,
    })
  }
  result.sort((a, b) => a.number - b.number)

  return { sprints: result, unsprinted }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/summaries/sprint-coverage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/summaries/sprint-coverage.ts __tests__/summaries/sprint-coverage.test.ts
git commit -m "feat: pure computeSprintCoverage helper [LUM-164]"
```

---

## Task 2: Repository methods

**Files:**

- Modify: `lib/repositories/milestone.repository.ts:126-142` (add method after `countTasksByStatus`)
- Modify: `lib/repositories/sprint.repository.ts` (add `findByIds` in the `sprintRepository` object)
- Test: `__tests__/milestone.repository.sprint-coverage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/milestone.repository.sprint-coverage.test.ts`:

```ts
jest.mock('@/lib/db/prisma', () => ({
  prisma: { task: { groupBy: jest.fn() }, sprint: { findMany: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { sprintRepository } from '@/lib/repositories/sprint.repository'

const groupBy = prisma.task.groupBy as jest.Mock
const findMany = prisma.sprint.findMany as jest.Mock

beforeEach(() => {
  groupBy.mockReset()
  findMany.mockReset()
})

describe('milestoneRepository.sprintCoverageCounts', () => {
  it('groups tasks by sprintId+status and flattens _count', async () => {
    groupBy.mockResolvedValue([
      { sprintId: 's3', status: 'DONE', _count: { _all: 4 } },
      { sprintId: null, status: 'TODO', _count: { _all: 2 } },
    ])
    const rows = await milestoneRepository.sprintCoverageCounts('m-1')
    expect(groupBy).toHaveBeenCalledWith({
      by: ['sprintId', 'status'],
      where: { milestoneId: 'm-1' },
      _count: { _all: true },
    })
    expect(rows).toEqual([
      { sprintId: 's3', status: 'DONE', count: 4 },
      { sprintId: null, status: 'TODO', count: 2 },
    ])
  })
})

describe('sprintRepository.findByIds', () => {
  it('returns [] without querying on empty input', async () => {
    const rows = await sprintRepository.findByIds([])
    expect(rows).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('scopes by id list and optional teamId', async () => {
    findMany.mockResolvedValue([
      { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
    ])
    const rows = await sprintRepository.findByIds(['s3'], 'team-1')
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['s3'] }, teamId: 'team-1' },
      select: { id: true, number: true, name: true, status: true },
    })
    expect(rows).toEqual([
      { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/milestone.repository.sprint-coverage.test.ts`
Expected: FAIL — `sprintCoverageCounts is not a function` / `findByIds is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/repositories/milestone.repository.ts`, add inside the `milestoneRepository` object, right after `countTasksByStatus` (after line 142's `},`):

```ts
  async sprintCoverageCounts(milestoneId: string) {
    const rows = await prisma.task.groupBy({
      by: ['sprintId', 'status'],
      where: { milestoneId },
      _count: { _all: true },
    })
    return rows.map(r => ({
      sprintId: r.sprintId,
      status: r.status,
      count: r._count._all,
    }))
  },
```

In `lib/repositories/sprint.repository.ts`, add inside the `sprintRepository` object (e.g. after `findActiveByTeam`, before `listByTeam`):

```ts
  /**
   * Bulk-fetch minimal sprint metadata by id, used to label a milestone's
   * sprint coverage. `teamId` is an optional defensive scope guard. Returns
   * `[]` without querying when `sprintIds` is empty.
   */
  async findByIds(sprintIds: string[], teamId?: string) {
    if (sprintIds.length === 0) return []
    return prisma.sprint.findMany({
      where: { id: { in: sprintIds }, ...(teamId ? { teamId } : {}) },
      select: { id: true, number: true, name: true, status: true },
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/milestone.repository.sprint-coverage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/milestone.repository.ts lib/repositories/sprint.repository.ts __tests__/milestone.repository.sprint-coverage.test.ts
git commit -m "feat: repo methods for sprint coverage aggregation [LUM-164]"
```

---

## Task 3: Service method `getSprintCoverage`

**Files:**

- Modify: `lib/services/milestone.service.ts` (add method to `milestoneService`; imports)
- Test: `__tests__/milestone.service.sprint-coverage.test.ts`

`getMilestone` (line 60) shows the auth pattern: `milestoneRepository.findById` → 404 if missing → `projectService.getProject(milestone.projectId, memberId)`. `getProject` returns the full project row (includes `teamId`). Reuse that for the scope guard.

- [ ] **Step 1: Write the failing test**

Create `__tests__/milestone.service.sprint-coverage.test.ts`:

```ts
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn(), sprintCoverageCounts: jest.fn() },
}))
jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: { findByIds: jest.fn() },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: jest.fn() },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { projectService } from '@/lib/services/project.service'

const findById = milestoneRepository.findById as jest.Mock
const counts = milestoneRepository.sprintCoverageCounts as jest.Mock
const findByIds = sprintRepository.findByIds as jest.Mock
const getProject = projectService.getProject as jest.Mock

beforeEach(() => {
  findById.mockReset()
  counts.mockReset()
  findByIds.mockReset()
  getProject.mockReset()
})

describe('milestoneService.getSprintCoverage', () => {
  it('aggregates coverage scoped by the project team', async () => {
    findById.mockResolvedValue({ id: 'm-1', projectId: 'p-1' })
    getProject.mockResolvedValue({ id: 'p-1', teamId: 'team-1' })
    counts.mockResolvedValue([
      { sprintId: 's3', status: 'DONE', count: 2 },
      { sprintId: 's3', status: 'TODO', count: 1 },
      { sprintId: null, status: 'TODO', count: 4 },
    ])
    findByIds.mockResolvedValue([
      { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
    ])

    const result = await milestoneService.getSprintCoverage('m-1', 'mem-1')

    expect(getProject).toHaveBeenCalledWith('p-1', 'mem-1')
    expect(findByIds).toHaveBeenCalledWith(['s3'], 'team-1')
    expect(result).toEqual({
      sprints: [
        {
          sprintId: 's3',
          number: 3,
          name: 'Sprint 3',
          status: 'ACTIVE',
          taskCount: 3,
          doneCount: 2,
        },
      ],
      unsprinted: 4,
    })
  })

  it('throws 404 when the milestone is missing', async () => {
    findById.mockResolvedValue(null)
    await expect(
      milestoneService.getSprintCoverage('nope', 'mem-1')
    ).rejects.toMatchObject({
      status: 404,
    })
  })

  it('skips the sprint fetch when no tasks are sprinted', async () => {
    findById.mockResolvedValue({ id: 'm-1', projectId: 'p-1' })
    getProject.mockResolvedValue({ id: 'p-1', teamId: 'team-1' })
    counts.mockResolvedValue([{ sprintId: null, status: 'TODO', count: 2 }])
    findByIds.mockResolvedValue([])

    const result = await milestoneService.getSprintCoverage('m-1', 'mem-1')
    expect(findByIds).toHaveBeenCalledWith([], 'team-1')
    expect(result).toEqual({ sprints: [], unsprinted: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/milestone.service.sprint-coverage.test.ts`
Expected: FAIL — `getSprintCoverage is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/services/milestone.service.ts`, add imports near the top (after line 6's `projectService` import):

```ts
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { computeSprintCoverage } from '@/lib/summaries/sprint-coverage'
```

Add this method to the `milestoneService` object (e.g. right after `getMilestone`, after line 67):

```ts
  async getSprintCoverage(milestoneId: string, memberId: string) {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    const project = await projectService.getProject(milestone.projectId, memberId)
    const counts = await milestoneRepository.sprintCoverageCounts(milestoneId)
    const sprintIds = [
      ...new Set(
        counts
          .map(c => c.sprintId)
          .filter((id): id is string => id !== null)
      ),
    ]
    const sprints = await sprintRepository.findByIds(sprintIds, project.teamId)
    return computeSprintCoverage(counts, sprints)
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/milestone.service.sprint-coverage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/milestone.service.ts __tests__/milestone.service.sprint-coverage.test.ts
git commit -m "feat: milestoneService.getSprintCoverage [LUM-164]"
```

---

## Task 4: API route enrichment

**Files:**

- Modify: `app/api/milestones/[milestoneId]/route.ts:19-25` (GET handler)
- Test: `__tests__/api-milestone-get.test.ts` (extend existing)

- [ ] **Step 1: Update the failing test**

In `__tests__/api-milestone-get.test.ts`, extend the service mock (line 7-9) to include the new method, and assert it's wired in. Replace the mock block and add coverage assertions:

```ts
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { getMilestone: jest.fn(), getSprintCoverage: jest.fn() },
}))
```

Add after the existing `mockCount` declaration (line 21):

```ts
const mockCoverage = milestoneService.getSprintCoverage as jest.Mock
```

Add `mockCoverage.mockReset()` in `beforeEach`. In the existing test body, before calling `GET`, add:

```ts
mockCoverage.mockResolvedValue({
  sprints: [
    {
      sprintId: 's3',
      number: 3,
      name: 'Sprint 3',
      status: 'ACTIVE',
      taskCount: 6,
      doneCount: 4,
    },
  ],
  unsprinted: 1,
})
```

And extend the assertion:

```ts
expect(body.milestone).toMatchObject({
  id: 'm-1',
  taskCounts: { TODO: 1, IN_PROGRESS: 2, IN_REVIEW: 0, DONE: 3 },
  sprintCoverage: {
    sprints: [
      {
        sprintId: 's3',
        number: 3,
        name: 'Sprint 3',
        status: 'ACTIVE',
        taskCount: 6,
        doneCount: 4,
      },
    ],
    unsprinted: 1,
  },
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-milestone-get.test.ts`
Expected: FAIL — `sprintCoverage` undefined in response.

- [ ] **Step 3: Write minimal implementation**

In `app/api/milestones/[milestoneId]/route.ts`, edit the GET handler body (lines 19-25) to:

```ts
const milestone = await milestoneService.getMilestone(
  milestoneId,
  identity.memberId
)
const taskCounts = await milestoneRepository.countTasksByStatus(milestoneId)
const health = milestoneHealthFromCounts(milestone, taskCounts, new Date())
const sprintCoverage = await milestoneService.getSprintCoverage(
  milestoneId,
  identity.memberId
)
return NextResponse.json({
  milestone: { ...milestone, taskCounts, health, sprintCoverage },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api-milestone-get.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/milestones/[milestoneId]/route.ts __tests__/api-milestone-get.test.ts
git commit -m "feat: enrich milestone detail API with sprintCoverage [LUM-164]"
```

---

## Task 5: CLI `milestone show` section

**Files:**

- Modify: `cli/src/commands/milestone-show.ts` (type, formatter, response parsing)
- Test: `cli/__tests__/milestone-show.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/__tests__/milestone-show.test.ts` (if a file already exists, add this `describe` block):

```ts
import {
  formatMilestoneShow,
  type MilestoneShowData,
} from '../src/commands/milestone-show'

const base: MilestoneShowData = {
  id: 'm-1',
  name: 'Q3 Launch',
  status: 'ACTIVE',
  startDate: null,
  targetDate: null,
  archivedAt: null,
  description: null,
  projectName: 'Web',
  taskCounts: { TODO: 2, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 4 },
  health: 'on-track',
  sprintCoverage: {
    sprints: [
      {
        sprintId: 's3',
        number: 3,
        name: 'Sprint 3',
        status: 'ACTIVE',
        taskCount: 6,
        doneCount: 4,
      },
      {
        sprintId: 's4',
        number: 4,
        name: 'Sprint 4',
        status: 'DRAFT',
        taskCount: 2,
        doneCount: 0,
      },
    ],
    unsprinted: 1,
  },
}

describe('formatMilestoneShow — sprint coverage', () => {
  it('renders a coverage row per sprint with done/total and an unsprinted line', () => {
    const out = formatMilestoneShow(base, [])
    expect(out).toContain('Sprint coverage:')
    expect(out).toContain('#3  ACTIVE  Sprint 3   4/6 done')
    expect(out).toContain('#4  DRAFT   Sprint 4   0/2 done')
    expect(out).toContain('未排期                  1 task')
  })

  it('omits the unsprinted line when unsprinted === 0', () => {
    const out = formatMilestoneShow(
      {
        ...base,
        sprintCoverage: {
          sprints: base.sprintCoverage!.sprints,
          unsprinted: 0,
        },
      },
      []
    )
    expect(out).not.toContain('未排期')
  })

  it('shows a placeholder when no sprints are covered', () => {
    const out = formatMilestoneShow(
      { ...base, sprintCoverage: { sprints: [], unsprinted: 0 } },
      []
    )
    expect(out).toContain('Sprint coverage: (no sprint coverage)')
  })

  it('omits the section entirely when sprintCoverage is absent', () => {
    const { sprintCoverage, ...without } = base
    const out = formatMilestoneShow(without, [])
    expect(out).not.toContain('Sprint coverage')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --config cli/jest.config.js cli/__tests__/milestone-show.test.ts` (or the CLI's test runner; if the CLI has no jest config, run `cd cli && npm test -- milestone-show`).
Expected: FAIL — `sprintCoverage` not on type / section not rendered.

- [ ] **Step 3: Write minimal implementation**

In `cli/src/commands/milestone-show.ts`:

(a) Add the coverage type to `MilestoneShowData` (after line 29's `health` field, inside the interface):

```ts
  /** Read-only sprint coverage derived from the milestone's tasks. */
  sprintCoverage?:
    | {
        sprints: Array<{
          sprintId: string
          number: number
          name: string
          status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
          taskCount: number
          doneCount: number
        }>
        unsprinted: number
      }
    | undefined
```

(b) Add a formatter helper above `formatMilestoneShow` (after `fmtHealth`, line 44):

```ts
function sprintCoverageLines(
  coverage: MilestoneShowData['sprintCoverage']
): string[] {
  if (!coverage) return []
  if (coverage.sprints.length === 0) {
    return ['', 'Sprint coverage: (no sprint coverage)']
  }
  const numW = Math.max(...coverage.sprints.map(s => `#${s.number}`.length))
  const statusW = Math.max(...coverage.sprints.map(s => s.status.length))
  const nameW = Math.max(
    ...coverage.sprints.map(s => sanitizeField(s.name).length)
  )
  const rows = coverage.sprints.map(s => {
    const num = `#${s.number}`.padEnd(numW)
    const status = s.status.padEnd(statusW)
    const name = sanitizeField(s.name).padEnd(nameW)
    return `  ${num}  ${status}  ${name}   ${s.doneCount}/${s.taskCount} done`
  })
  if (coverage.unsprinted > 0) {
    const label = '未排期'.padEnd(numW + 2 + statusW + 2 + nameW)
    rows.push(
      `  ${label}   ${coverage.unsprinted} task${coverage.unsprinted === 1 ? '' : 's'}`
    )
  }
  return ['', 'Sprint coverage:', ...rows]
}
```

(c) In `formatMilestoneShow`, insert the coverage lines between the `Tasks:` summary line and the task table. Change the tail of the function (lines 66-71) to:

```ts
    `Tasks:        ${total} total (TODO ${m.taskCounts.TODO} / IN_PROGRESS ${m.taskCounts.IN_PROGRESS} / IN_REVIEW ${m.taskCounts.IN_REVIEW} / DONE ${m.taskCounts.DONE})`,
  ]
  lines.push(...sprintCoverageLines(m.sprintCoverage))
  if (tasks.length > 0) {
    lines.push('', formatTaskListTable(tasks))
  }
  return lines.join('\n')
```

(d) Extend the response parse type (lines 131-144) to include `sprintCoverage`, and pass it through in the `formatMilestoneShow({...})` call (lines 164-175). Add to the parsed `milestone` type:

```ts
      sprintCoverage?: MilestoneShowData['sprintCoverage']
```

And add to the object passed to `formatMilestoneShow`:

```ts
        sprintCoverage: milestone.sprintCoverage,
```

- [ ] **Step 4: Run test to verify it passes**

Run the CLI test from Step 2.
Expected: PASS (4 tests). The exact-string assertions assume `nameW`/`statusW` widths produce the documented spacing; if padding differs, adjust the expected strings in the test to match the formatter's deterministic output rather than changing the formatter.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/milestone-show.ts cli/__tests__/milestone-show.test.ts
git commit -m "feat: sprint coverage section in lumo milestone show [LUM-164]"
```

---

## Task 6: Web — api-client type, component, wiring, i18n

**Files:**

- Modify: `lib/api-client/milestones.ts:6-26` (`ApiMilestone`)
- Create: `app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx` (render between description and `<TaskListByMilestone/>`)
- Modify: `lib/i18n/*.json` (16 files)
- Test: `__tests__/components/MilestoneSprintCoverage.test.tsx`

- [ ] **Step 1: Add the api-client type**

In `lib/api-client/milestones.ts`, add after the `health` field on `ApiMilestone` (line 25):

```ts
  sprintCoverage?: {
    sprints: Array<{
      sprintId: string
      number: number
      name: string
      status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
      taskCount: number
      doneCount: number
    }>
    unsprinted: number
  } | null
```

- [ ] **Step 2: Add i18n keys to all 16 locale files**

Add these 6 keys to each file in `lib/i18n/`. Place them next to the existing `milestone.*` keys. Use the per-locale translations in the table below (progress is `{done}/{total}` in every locale — numerals only). **No English fallback for non-English locales.**

Keys (id → English):

- `milestone.sprintCoverage.title` → "Sprint coverage"
- `milestone.sprintCoverage.empty` → "No sprints covered"
- `milestone.sprintCoverage.unsprinted` → "{count} unsprinted"
- `milestone.sprintCoverage.progress` → "{done}/{total}"
- `milestone.sprintCoverage.status.DRAFT` / `.ACTIVE` / `.CLOSED` → see table

| locale           | title                  | empty                     | unsprinted              | DRAFT / ACTIVE / CLOSED        |
| ---------------- | ---------------------- | ------------------------- | ----------------------- | ------------------------------ |
| en, en-GB, en-AU | Sprint coverage        | No sprints covered        | {count} unsprinted      | Draft / Active / Closed        |
| zh-CN            | Sprint 覆盖            | 未覆盖任何 Sprint         | {count} 个未排期        | 草稿 / 进行中 / 已关闭         |
| zh-TW            | Sprint 覆蓋            | 未覆蓋任何 Sprint         | {count} 個未排期        | 草稿 / 進行中 / 已關閉         |
| ja               | スプリント網羅         | 対象スプリントなし        | 未割当 {count} 件       | 下書き / 進行中 / 終了         |
| ko               | 스프린트 범위          | 해당 스프린트 없음        | 미배정 {count}개        | 초안 / 진행 중 / 종료          |
| de               | Sprint-Abdeckung       | Keine Sprints abgedeckt   | {count} ohne Sprint     | Entwurf / Aktiv / Geschlossen  |
| es, es-419       | Cobertura de sprints   | Ningún sprint cubierto    | {count} sin sprint      | Borrador / Activo / Cerrado    |
| fr               | Couverture des sprints | Aucun sprint couvert      | {count} sans sprint     | Brouillon / Actif / Clôturé    |
| ru               | Охват спринтов         | Нет охваченных спринтов   | {count} без спринта     | Черновик / Активный / Закрыт   |
| hi               | स्प्रिंट कवरेज         | कोई स्प्रिंट शामिल नहीं   | {count} बिना स्प्रिंट   | ड्राफ़्ट / सक्रिय / बंद        |
| id               | Cakupan sprint         | Tidak ada sprint tercakup | {count} tanpa sprint    | Draf / Aktif / Ditutup         |
| ms               | Liputan sprint         | Tiada sprint diliputi     | {count} tanpa sprint    | Draf / Aktif / Ditutup         |
| vi               | Phạm vi sprint         | Không có sprint nào       | {count} chưa xếp sprint | Bản nháp / Đang chạy / Đã đóng |

For every locale add, e.g. (zh-CN shown):

```json
  "milestone.sprintCoverage.title": "Sprint 覆盖",
  "milestone.sprintCoverage.empty": "未覆盖任何 Sprint",
  "milestone.sprintCoverage.unsprinted": "{count} 个未排期",
  "milestone.sprintCoverage.progress": "{done}/{total}",
  "milestone.sprintCoverage.status.DRAFT": "草稿",
  "milestone.sprintCoverage.status.ACTIVE": "进行中",
  "milestone.sprintCoverage.status.CLOSED": "已关闭",
```

- [ ] **Step 3: Write the failing component test**

Create `__tests__/components/MilestoneSprintCoverage.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import en from '@/lib/i18n/en.json'
import { MilestoneSprintCoverage } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage'

function renderWith(coverage: any) {
  return render(
    <IntlProvider locale='en' messages={en as Record<string, string>}>
      <MilestoneSprintCoverage coverage={coverage} />
    </IntlProvider>
  )
}

describe('MilestoneSprintCoverage', () => {
  it('renders a row per sprint with progress and the unsprinted count', () => {
    renderWith({
      sprints: [
        {
          sprintId: 's3',
          number: 3,
          name: 'Sprint 3',
          status: 'ACTIVE',
          taskCount: 6,
          doneCount: 4,
        },
      ],
      unsprinted: 2,
    })
    expect(screen.getByText('Sprint coverage')).toBeInTheDocument()
    expect(screen.getByText('Sprint 3')).toBeInTheDocument()
    expect(screen.getByText('4/6')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('2 unsprinted')).toBeInTheDocument()
  })

  it('renders the empty state when no sprints are covered', () => {
    renderWith({ sprints: [], unsprinted: 0 })
    expect(screen.getByText('No sprints covered')).toBeInTheDocument()
  })

  it('renders nothing when coverage is null', () => {
    const { container } = renderWith(null)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest __tests__/components/MilestoneSprintCoverage.test.tsx`
Expected: FAIL — cannot find `MilestoneSprintCoverage`.

- [ ] **Step 5: Write the component**

Create `app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone } from '@/lib/api-client/milestones'

type Coverage = NonNullable<ApiMilestone['sprintCoverage']>
type SprintStatus = Coverage['sprints'][number]['status']

const STATUS_BADGE: Record<SprintStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  CLOSED:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

export function MilestoneSprintCoverage({
  coverage,
}: {
  coverage: ApiMilestone['sprintCoverage']
}) {
  const intl = useIntl()
  if (!coverage) return null

  return (
    <section className='space-y-2'>
      <h3 className='text-sm font-medium text-foreground'>
        {intl.formatMessage({ id: 'milestone.sprintCoverage.title' })}
      </h3>

      {coverage.sprints.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.sprintCoverage.empty' })}
        </p>
      ) : (
        <ul className='space-y-1'>
          {coverage.sprints.map(s => (
            <li
              key={s.sprintId}
              className='flex items-center gap-2 text-sm text-foreground'
            >
              <span className='text-muted-foreground tabular-nums'>
                #{s.number}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status]}`}
              >
                {intl.formatMessage({
                  id: `milestone.sprintCoverage.status.${s.status}`,
                })}
              </span>
              <span className='flex-1 truncate'>{s.name}</span>
              <span className='tabular-nums text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'milestone.sprintCoverage.progress' },
                  { done: s.doneCount, total: s.taskCount }
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {coverage.unsprinted > 0 && (
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage(
            { id: 'milestone.sprintCoverage.unsprinted' },
            { count: coverage.unsprinted }
          )}
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest __tests__/components/MilestoneSprintCoverage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Wire into the detail page**

In `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`, import the component near the other imports:

```tsx
import { MilestoneSprintCoverage } from '../milestones/MilestoneSprintCoverage'
```

Render it between the milestone header/description block and `<TaskListByMilestone />` (the spec's slot, ~line 134-136). The milestone object from `useMilestone` is in scope (e.g. `milestone`):

```tsx
        <MilestoneSprintCoverage coverage={milestone.sprintCoverage} />
        <TaskListByMilestone /* existing props unchanged */ />
```

(Use the actual local variable name the component uses for the loaded milestone — confirm by reading the file; it is the value returned by `useMilestone`/`useMilestoneByProjectAndSlug`.)

- [ ] **Step 8: Verify types and token lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint:tokens`
Expected: pass. The badge colors reuse the same Tailwind classes already used by `SprintSidebar`, so no new raw hex is introduced. If `lint:tokens` flags anything, follow the project's token convention (do not add raw hex).

- [ ] **Step 9: Commit**

```bash
git add lib/api-client/milestones.ts \
  app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage.tsx \
  app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx \
  lib/i18n/*.json \
  __tests__/components/MilestoneSprintCoverage.test.tsx
git commit -m "feat: sprint coverage block on web milestone detail [LUM-164]"
```

---

## Task 7: Docs sync — SKILL.md

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md` (the `lumo milestone show` section)

CLAUDE.md mandates SKILL.md sync whenever a `cli/src/commands/` command's output changes.

- [ ] **Step 1: Update the milestone show docs**

In `.claude/skills/lumo/SKILL.md`, find the `### lumo milestone show <identifier>` section. Update its description to mention the new output, adding a sentence and example after the existing health/task-table description:

````markdown
It also prints a **Sprint coverage** section (above the task table) listing which
sprints the milestone's tasks span, each with status and `done/total` progress,
plus an `未排期` line counting milestone tasks with no sprint. The section is
derived from the milestone's tasks (no schema relation). When no task is in any
sprint it prints `Sprint coverage: (no sprint coverage)`.

Example coverage section:

\```
Sprint coverage:
#3 ACTIVE Sprint 3 4/6 done
#4 DRAFT Sprint 4 0/2 done
未排期 1 task
\```
````

(Remove the backslashes before the triple backticks — they are escaping for this plan only.)

- [ ] **Step 2: Verify the frontmatter triggers still cover it**

The skill `description` frontmatter already includes milestone triggers ("milestone tasks", "show milestone"). No new trigger word is required for a read-only output addition. Confirm by reading the frontmatter; if "sprint coverage" would help discovery, append it to the milestone trigger list.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: document sprint coverage in milestone show SKILL.md [LUM-164]"
```

---

## Final verification

- [ ] **Run the full new test set + type check**

```bash
npx jest __tests__/summaries/sprint-coverage.test.ts \
  __tests__/milestone.repository.sprint-coverage.test.ts \
  __tests__/milestone.service.sprint-coverage.test.ts \
  __tests__/api-milestone-get.test.ts \
  __tests__/components/MilestoneSprintCoverage.test.tsx
npx tsc --noEmit
(cd cli && npm test -- milestone-show)
```

Expected: all green, no TS errors.

- [ ] **Confirm no console.log, no new npm packages, branch name `lumo/LUM-164-milestone-sprint-coverage`.**

- [ ] **PR:** title `feat: milestone↔sprint coverage (read-only) [LUM-164]`. Body notes: no migration, no new deps, SKILL.md updated, CLI output changed.

---

## Spec coverage check

- Derived aggregation, no migration → Task 1+2 (groupBy, pure helper). ✅
- Server-side single computation, enriched on detail API → Task 3+4. ✅
- `done/total` granularity → Task 1 (doneCount/taskCount), rendered in Task 5+6. ✅
- `unsprinted` bucket → Task 1, rendered Task 5+6. ✅
- CLI section before task table → Task 5. ✅
- Web block between description and task list, badge reuse, SRP component → Task 6. ✅
- 16 locale files, no English fallback → Task 6 Step 2. ✅
- Cross-team safety via `findByIds(..., teamId)` → Task 2+3. ✅
- Tests (pure helper, CLI formatter, + repo/service/api/component) → Tasks 1-6. ✅
- SKILL.md sync → Task 7. ✅
