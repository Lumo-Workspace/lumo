# Sprint Burndown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sprint burndown chart that reconstructs each day's remaining (not-done) task count from the `TaskActivity` stream and renders it as a hand-rolled SVG line chart (actual + ideal line) on the sprint detail sidebar.

**Architecture:** A pure, Prisma-free function (`computeBurndownSeries`) does the event-replay math and is the main unit-test surface. A repository loads the candidate tasks + their `STATUS_CHANGED`/`SPRINT_CHANGED` activities; a thin service orchestrates repo + pure function; a thin GET route exposes it; a react-query hook + SVG component render it. No schema change.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma (Neon Postgres), @tanstack/react-query, react-intl, Jest + jsdom, Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-06-03-sprint-burndown-design.md`

**Branch:** `lumo/LUM-169-sprint-burndown` (already created off origin/main).

---

## File Structure

| File                                                                      | Create/Modify | Responsibility                                               |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------ |
| `lib/services/sprint-burndown.ts`                                         | Create        | Pure replay algorithm + exported types (no Prisma, no clock) |
| `__tests__/sprint-burndown.test.ts`                                       | Create        | Unit tests for the pure function                             |
| `lib/repositories/sprint-burndown.repository.ts`                          | Create        | Load candidate tasks + activities for a sprint               |
| `lib/services/sprint-burndown.service.ts`                                 | Create        | Orchestrate repo + pure fn, sprint existence/DRAFT guard     |
| `__tests__/sprint-burndown.service.test.ts`                               | Create        | Service test with mocked repos                               |
| `app/api/sprints/[sprintId]/burndown/route.ts`                            | Create        | Thin GET: auth → service → JSON                              |
| `app/workspace/[workspaceUrl]/constants.ts`                               | Modify        | Add `API.sprints.burndown`                                   |
| `lib/api-client/sprints.ts`                                               | Modify        | Add `SprintBurndownResponse` type + `getBurndown` method     |
| `lib/query/keys.ts`                                                       | Modify        | Add `queryKeys.sprints.burndown`                             |
| `app/workspace/[workspaceUrl]/hooks/useSprints.ts`                        | Modify        | Add `useSprintBurndown` hook                                 |
| `lib/i18n/*.json` (16 files)                                              | Modify        | Add 4 `sprint.burndown.*` keys per locale                    |
| `app/workspace/[workspaceUrl]/sprints/components/SprintBurndownChart.tsx` | Create        | SVG chart component                                          |
| `__tests__/components/SprintBurndownChart.test.tsx`                       | Create        | Component render test                                        |
| `app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx`  | Modify        | Render chart under SprintSidebar                             |

---

## Task 1: Pure replay function `computeBurndownSeries`

**Files:**

- Create: `lib/services/sprint-burndown.ts`
- Test: `__tests__/sprint-burndown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/sprint-burndown.test.ts`:

```typescript
import { computeBurndownSeries } from '@/lib/services/sprint-burndown'
import type { BurndownComputeInput } from '@/lib/services/sprint-burndown'

const SPRINT = 'sprint-1'

function statusEvt(taskId: string, from: string, to: string, day: string) {
  return {
    taskId,
    type: 'STATUS_CHANGED' as const,
    payload: { from, to },
    createdAt: new Date(`${day}T10:00:00.000Z`),
  }
}
function sprintEvt(
  taskId: string,
  fromSprintId: string | null,
  toSprintId: string | null,
  day: string
) {
  return {
    taskId,
    type: 'SPRINT_CHANGED' as const,
    payload: { fromSprintId, toSprintId, reason: 'manual' },
    createdAt: new Date(`${day}T10:00:00.000Z`),
  }
}

function baseInput(over: Partial<BurndownComputeInput>): BurndownComputeInput {
  return {
    sprintId: SPRINT,
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-03T00:00:00.000Z'),
    status: 'CLOSED',
    now: new Date('2026-06-10T00:00:00.000Z'),
    tasks: [],
    activities: [],
    ...over,
  }
}

describe('computeBurndownSeries', () => {
  test('basic burndown: 3 tasks, two finish over the window', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'DONE' },
          { id: 't2', sprintId: SPRINT, status: 'DONE' },
          { id: 't3', sprintId: SPRINT, status: 'TODO' },
        ],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-02'),
          statusEvt('t2', 'TODO', 'DONE', '2026-06-03'),
        ],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([3, 2, 1])
    expect(out.total).toBe(3)
    expect(out.start).toBe('2026-06-01')
    expect(out.end).toBe('2026-06-03')
    expect(out.unit).toBe('tasks')
  })

  test('ideal line is linear from total to 0', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'TODO' },
          { id: 't2', sprintId: SPRINT, status: 'TODO' },
        ],
      })
    )
    // total = 2, 3 days → ideal: [2, 1, 0]
    expect(out.series.map(p => p.ideal)).toEqual([2, 1, 0])
  })

  test('task added mid-window raises remaining on its join day', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'TODO' },
          { id: 't2', sprintId: SPRINT, status: 'TODO' },
        ],
        activities: [sprintEvt('t2', null, SPRINT, '2026-06-02')],
      })
    )
    // t1 present all 3 days; t2 joins on day 2
    expect(out.series.map(p => p.remaining)).toEqual([1, 2, 2])
  })

  test('task spilled out mid-window drops remaining on its leave day', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'TODO' },
          { id: 't2', sprintId: null, status: 'TODO' },
        ],
        activities: [sprintEvt('t2', SPRINT, null, '2026-06-03')],
      })
    )
    // t2 was in sprint days 1-2 (current sprintId null, but event says it left on day 3
    // → before day 3 it was in SPRINT via fromSprintId)
    expect(out.series.map(p => p.remaining)).toEqual([2, 2, 1])
  })

  test('task with no SPRINT_CHANGED falls back to current sprintId', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'TODO' }],
        activities: [],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([1, 1, 1])
  })

  test('status reopened then redone: statusAt uses last event before T', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'DONE' }],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-01'),
          statusEvt('t1', 'DONE', 'IN_PROGRESS', '2026-06-02'),
          statusEvt('t1', 'IN_PROGRESS', 'DONE', '2026-06-03'),
        ],
      })
    )
    // day1: DONE→0, day2: reopened→1, day3: DONE→0
    expect(out.series.map(p => p.remaining)).toEqual([0, 1, 0])
  })

  test('ACTIVE sprint: future days have null remaining, ideal still filled', () => {
    const out = computeBurndownSeries(
      baseInput({
        status: 'ACTIVE',
        now: new Date('2026-06-02T12:00:00.000Z'),
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'TODO' }],
      })
    )
    // day1 + day2 computed (<= now), day3 is future → null
    expect(out.series.map(p => p.remaining)).toEqual([1, 1, null])
    expect(out.series.map(p => p.ideal)).toEqual([1, 0.5, 0])
  })

  test('dirty payload events are skipped, not thrown', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'TODO' }],
        activities: [
          {
            taskId: 't1',
            type: 'STATUS_CHANGED',
            payload: null,
            createdAt: new Date('2026-06-02T10:00:00.000Z'),
          },
          {
            taskId: 't1',
            type: 'STATUS_CHANGED',
            payload: { from: 'TODO' },
            createdAt: new Date('2026-06-02T11:00:00.000Z'),
          },
        ],
      })
    )
    // both events malformed → ignored → t1 stays TODO (remaining 1) all days
    expect(out.series.map(p => p.remaining)).toEqual([1, 1, 1])
  })

  test('empty sprint: all zeros, no throw', () => {
    const out = computeBurndownSeries(baseInput({ tasks: [], activities: [] }))
    expect(out.total).toBe(0)
    expect(out.series.map(p => p.remaining)).toEqual([0, 0, 0])
    expect(out.series.map(p => p.ideal)).toEqual([0, 0, 0])
  })

  test('single-day window: ideal equals total', () => {
    const out = computeBurndownSeries(
      baseInput({
        endDate: new Date('2026-06-01T00:00:00.000Z'),
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'TODO' }],
      })
    )
    expect(out.series).toHaveLength(1)
    expect(out.series[0].ideal).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/sprint-burndown.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/sprint-burndown'`.

- [ ] **Step 3: Write the implementation**

Create `lib/services/sprint-burndown.ts`:

```typescript
import type { TaskStatus } from '@prisma/client'

export interface BurndownTaskInput {
  id: string
  sprintId: string | null
  status: TaskStatus
}

export interface BurndownActivityInput {
  taskId: string
  type: 'STATUS_CHANGED' | 'SPRINT_CHANGED'
  payload: unknown
  createdAt: Date
}

export interface BurndownComputeInput {
  sprintId: string
  startDate: Date
  endDate: Date
  status: 'ACTIVE' | 'CLOSED'
  now: Date
  tasks: BurndownTaskInput[]
  activities: BurndownActivityInput[]
}

export interface BurndownPoint {
  date: string
  remaining: number | null
  ideal: number
}

export interface BurndownSeries {
  sprintId: string
  start: string
  end: string
  unit: 'tasks'
  total: number
  series: BurndownPoint[]
}

interface StatusEvt {
  createdAt: Date
  from: TaskStatus
  to: TaskStatus
}
interface SprintEvt {
  createdAt: Date
  fromSprintId: string | null
  toSprintId: string | null
}

const DAY_MS = 86_400_000

function toUtcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function enumerateUtcDays(start: Date, end: Date): Date[] {
  const days: Date[] = []
  let cur = utcMidnight(start)
  const last = utcMidnight(end)
  while (cur <= last) {
    days.push(new Date(cur))
    cur += DAY_MS
  }
  return days
}

function parseStatusPayload(
  p: unknown
): { from: TaskStatus; to: TaskStatus } | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (typeof o.from !== 'string' || typeof o.to !== 'string') return null
  return { from: o.from as TaskStatus, to: o.to as TaskStatus }
}

function parseSprintPayload(
  p: unknown
): { fromSprintId: string | null; toSprintId: string | null } | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (!('fromSprintId' in o) || !('toSprintId' in o)) return null
  const from = o.fromSprintId
  const to = o.toSprintId
  const okFrom = from === null || typeof from === 'string'
  const okTo = to === null || typeof to === 'string'
  if (!okFrom || !okTo) return null
  return {
    fromSprintId: (from as string | null) ?? null,
    toSprintId: (to as string | null) ?? null,
  }
}

/** State of a step-function at time tMs: last event whose createdAt <= tMs. */
function statusAt(
  events: StatusEvt[],
  tMs: number,
  fallback: TaskStatus
): TaskStatus {
  if (events.length === 0) return fallback
  let chosen: StatusEvt | null = null
  for (const e of events) {
    if (e.createdAt.getTime() <= tMs) chosen = e
    else break
  }
  return chosen ? chosen.to : events[0].from
}

function sprintAt(
  events: SprintEvt[],
  tMs: number,
  fallback: string | null
): string | null {
  if (events.length === 0) return fallback
  let chosen: SprintEvt | null = null
  for (const e of events) {
    if (e.createdAt.getTime() <= tMs) chosen = e
    else break
  }
  return chosen ? chosen.toSprintId : events[0].fromSprintId
}

export function computeBurndownSeries(
  input: BurndownComputeInput
): BurndownSeries {
  const { sprintId, startDate, endDate, status, now, tasks, activities } = input

  const statusByTask = new Map<string, StatusEvt[]>()
  const sprintByTask = new Map<string, SprintEvt[]>()

  for (const a of activities) {
    if (a.type === 'STATUS_CHANGED') {
      const p = parseStatusPayload(a.payload)
      if (!p) continue
      const arr = statusByTask.get(a.taskId) ?? []
      arr.push({ createdAt: a.createdAt, from: p.from, to: p.to })
      statusByTask.set(a.taskId, arr)
    } else if (a.type === 'SPRINT_CHANGED') {
      const p = parseSprintPayload(a.payload)
      if (!p) continue
      const arr = sprintByTask.get(a.taskId) ?? []
      arr.push({
        createdAt: a.createdAt,
        fromSprintId: p.fromSprintId,
        toSprintId: p.toSprintId,
      })
      sprintByTask.set(a.taskId, arr)
    }
  }
  for (const arr of statusByTask.values())
    arr.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
  for (const arr of sprintByTask.values())
    arr.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())

  const taskById = new Map(tasks.map(t => [t.id, t]))
  const candidates = new Set<string>()
  for (const t of tasks) if (t.sprintId === sprintId) candidates.add(t.id)
  for (const [taskId, evts] of sprintByTask) {
    if (
      evts.some(e => e.fromSprintId === sprintId || e.toSprintId === sprintId)
    ) {
      candidates.add(taskId)
    }
  }

  function countRemaining(eodMs: number): number {
    let count = 0
    for (const id of candidates) {
      const fallbackSprint = taskById.get(id)?.sprintId ?? null
      if (
        sprintAt(sprintByTask.get(id) ?? [], eodMs, fallbackSprint) !== sprintId
      )
        continue
      const fallbackStatus = taskById.get(id)?.status ?? 'TODO'
      if (
        statusAt(statusByTask.get(id) ?? [], eodMs, fallbackStatus) !== 'DONE'
      )
        count++
    }
    return count
  }

  const days = enumerateUtcDays(startDate, endDate)
  const nowMs = now.getTime()

  const firstEod = utcMidnight(days[0]) + DAY_MS - 1
  const total = days.length ? countRemaining(firstEod) : 0

  const n = days.length
  const series: BurndownPoint[] = days.map((day, idx) => {
    const eod = utcMidnight(day) + DAY_MS - 1
    const isFuture = eod > nowMs
    const remaining =
      status === 'ACTIVE' && isFuture ? null : countRemaining(eod)
    const ideal =
      n === 1
        ? total
        : Math.round(((total * (n - 1 - idx)) / (n - 1)) * 100) / 100
    return { date: toUtcDateKey(day), remaining, ideal }
  })

  return {
    sprintId,
    start: days.length ? toUtcDateKey(days[0]) : toUtcDateKey(startDate),
    end: days.length ? toUtcDateKey(days[n - 1]) : toUtcDateKey(endDate),
    unit: 'tasks',
    total,
    series,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/sprint-burndown.test.ts`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/services/sprint-burndown.ts __tests__/sprint-burndown.test.ts
git commit -m "feat: sprint burndown replay pure function [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Repository `sprint-burndown.repository.ts`

**Files:**

- Create: `lib/repositories/sprint-burndown.repository.ts`

This layer has no unit test (it's a thin Prisma query; jest mocks Prisma here per the project's pattern and the query logic is best covered by the service test in Task 3 + manual verification). Mirrors the import/select style of `lib/repositories/sprint-summary.repository.ts`.

- [ ] **Step 1: Write the implementation**

Create `lib/repositories/sprint-burndown.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { TaskStatus } from '@prisma/client'

export interface BurndownInputs {
  tasks: Array<{ id: string; sprintId: string | null; status: TaskStatus }>
  activities: Array<{
    taskId: string
    type: 'STATUS_CHANGED' | 'SPRINT_CHANGED'
    payload: unknown
    createdAt: Date
  }>
}

export const sprintBurndownRepository = {
  /**
   * Load the candidate task set + their status/sprint activity timelines.
   * Candidates = tasks currently in the sprint ∪ tasks with any SPRINT_CHANGED
   * whose payload from/to references this sprint (i.e. tasks that left it).
   */
  async loadInputs(sprintId: string): Promise<BurndownInputs> {
    const currentTaskIds = (
      await prisma.task.findMany({
        where: { sprintId },
        select: { id: true },
      })
    ).map(t => t.id)

    const sprintChanges = await prisma.taskActivity.findMany({
      where: {
        type: 'SPRINT_CHANGED',
        OR: [
          { payload: { path: ['fromSprintId'], equals: sprintId } },
          { payload: { path: ['toSprintId'], equals: sprintId } },
        ],
      },
      select: { taskId: true },
    })

    const ids = [
      ...new Set([...currentTaskIds, ...sprintChanges.map(a => a.taskId)]),
    ]

    if (ids.length === 0) return { tasks: [], activities: [] }

    const tasks = await prisma.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, sprintId: true, status: true },
    })

    const activities = await prisma.taskActivity.findMany({
      where: {
        taskId: { in: ids },
        type: { in: ['STATUS_CHANGED', 'SPRINT_CHANGED'] },
      },
      select: { taskId: true, type: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    return {
      tasks,
      activities: activities as unknown as BurndownInputs['activities'],
    }
  },
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `sprint-burndown.repository.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/repositories/sprint-burndown.repository.ts
git commit -m "feat: sprint burndown repository loadInputs [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Service `sprint-burndown.service.ts`

**Files:**

- Create: `lib/services/sprint-burndown.service.ts`
- Test: `__tests__/sprint-burndown.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/sprint-burndown.service.test.ts`:

```typescript
const mockFindById = jest.fn()
const mockLoadInputs = jest.fn()

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    findById: (...a: unknown[]) => mockFindById(...a),
  },
}))
jest.mock('@/lib/repositories/sprint-burndown.repository', () => ({
  sprintBurndownRepository: {
    loadInputs: (...a: unknown[]) => mockLoadInputs(...a),
  },
}))

import { sprintBurndownService } from '@/lib/services/sprint-burndown.service'

beforeEach(() => {
  mockFindById.mockReset()
  mockLoadInputs.mockReset()
})

describe('sprintBurndownService.compute', () => {
  test('404 when sprint missing', async () => {
    mockFindById.mockResolvedValue(null)
    await expect(
      sprintBurndownService.compute('nope', new Date('2026-06-10T00:00:00Z'))
    ).rejects.toMatchObject({ status: 404 })
  })

  test('409 when sprint is DRAFT', async () => {
    mockFindById.mockResolvedValue({
      id: 's1',
      status: 'DRAFT',
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-03T00:00:00Z'),
    })
    await expect(
      sprintBurndownService.compute('s1', new Date('2026-06-10T00:00:00Z'))
    ).rejects.toMatchObject({ status: 409 })
  })

  test('computes series for a CLOSED sprint', async () => {
    mockFindById.mockResolvedValue({
      id: 's1',
      status: 'CLOSED',
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-02T00:00:00Z'),
    })
    mockLoadInputs.mockResolvedValue({
      tasks: [{ id: 't1', sprintId: 's1', status: 'DONE' }],
      activities: [
        {
          taskId: 't1',
          type: 'STATUS_CHANGED',
          payload: { from: 'TODO', to: 'DONE' },
          createdAt: new Date('2026-06-02T10:00:00Z'),
        },
      ],
    })
    const out = await sprintBurndownService.compute(
      's1',
      new Date('2026-06-10T00:00:00Z')
    )
    expect(out.sprintId).toBe('s1')
    expect(out.series.map(p => p.remaining)).toEqual([1, 0])
    expect(mockLoadInputs).toHaveBeenCalledWith('s1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/sprint-burndown.service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/sprint-burndown.service'`.

- [ ] **Step 3: Write the implementation**

Create `lib/services/sprint-burndown.service.ts`:

```typescript
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { sprintBurndownRepository } from '@/lib/repositories/sprint-burndown.repository'
import {
  computeBurndownSeries,
  type BurndownSeries,
} from '@/lib/services/sprint-burndown'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export const sprintBurndownService = {
  async compute(sprintId: string, now: Date): Promise<BurndownSeries> {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (sprint.status === 'DRAFT') httpError(409, 'sprint not started')

    const { tasks, activities } =
      await sprintBurndownRepository.loadInputs(sprintId)

    return computeBurndownSeries({
      sprintId,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      status: sprint.status as 'ACTIVE' | 'CLOSED',
      now,
      tasks,
      activities,
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/sprint-burndown.service.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/services/sprint-burndown.service.ts __tests__/sprint-burndown.service.test.ts
git commit -m "feat: sprint burndown service [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: API route + client wiring

**Files:**

- Create: `app/api/sprints/[sprintId]/burndown/route.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `lib/api-client/sprints.ts`
- Modify: `lib/query/keys.ts`

- [ ] **Step 1: Add the API constant**

In `app/workspace/[workspaceUrl]/constants.ts`, inside the `sprints: { ... }` block (after the `summary` / `summaryRetry` lines around line 133-135), add:

```typescript
    burndown: (sprintId: string) => `/api/sprints/${sprintId}/burndown`,
```

- [ ] **Step 2: Add the query key**

In `lib/query/keys.ts`, inside the `sprints: { ... }` block (after the `summary` line, line 49), add:

```typescript
    burndown: (sprintId: string) => ['sprints', 'burndown', sprintId] as const,
```

- [ ] **Step 3: Add the api-client type + method**

In `lib/api-client/sprints.ts`, add this exported interface near the other interfaces (after `SprintListResult`, ~line 20):

```typescript
export interface SprintBurndownResponse {
  sprintId: string
  start: string
  end: string
  unit: 'tasks'
  total: number
  series: Array<{ date: string; remaining: number | null; ideal: number }>
}
```

And inside the `sprintsClient` object, after `getSummary` (~line 105), add:

```typescript
  getBurndown(sprintId: string) {
    return apiFetch<SprintBurndownResponse>(API.sprints.burndown(sprintId))
  },
```

- [ ] **Step 4: Create the route**

Create `app/api/sprints/[sprintId]/burndown/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'
import { sprintBurndownService } from '@/lib/services/sprint-burndown.service'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * GET /api/sprints/[sprintId]/burndown — Reconstructed daily-remaining series.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      sprint.team.workspaceId,
      sprint.teamId,
      identity.clerkId
    )

    const data = await sprintBurndownService.compute(sprintId, new Date())
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/sprints/[sprintId]/burndown/route.ts app/workspace/[workspaceUrl]/constants.ts lib/api-client/sprints.ts lib/query/keys.ts
git commit -m "feat: sprint burndown API route + client wiring [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Hook + i18n keys

**Files:**

- Modify: `app/workspace/[workspaceUrl]/hooks/useSprints.ts`
- Modify: all 16 files under `lib/i18n/`

- [ ] **Step 1: Add the hook**

In `app/workspace/[workspaceUrl]/hooks/useSprints.ts`:

First add a type import near the top (with the other `@/lib/api-client` imports):

```typescript
import type { SprintBurndownResponse } from '@/lib/api-client/sprints'
```

Then add this hook at the end of the file (mirrors `useSprintSummary`):

```typescript
/**
 * Fetches the reconstructed burndown series for a sprint.
 * Returns { burndown, isLoading, error }.
 */
export function useSprintBurndown(sprintId: string | null) {
  const query = useQuery<SprintBurndownResponse | null>({
    queryKey: sprintId
      ? queryKeys.sprints.burndown(sprintId)
      : ['sprints', 'burndown', 'disabled'],
    queryFn: async () => {
      const res = await sprintsClient.getBurndown(sprintId as string)
      return res ?? null
    },
    enabled: !!sprintId,
  })

  return {
    burndown: query.data ?? null,
    isLoading: query.isPending && !!sprintId,
    error: query.error ?? undefined,
  }
}
```

(If `sprintsClient` is imported from the barrel `@/lib/api-client` rather than `./sprints`, import the type from the same place — verify the existing import line for `sprintsClient` and match it.)

- [ ] **Step 2: Add i18n keys to every locale**

Add these four keys to **each** of the 16 files in `lib/i18n/`. Keys are flat dot-notation. Insert them in alphabetical position near other `sprint.*` keys (or anywhere — the files are flat maps). Use the exact translations below per file.

`en.json`, `en-AU.json`, `en-GB.json`:

```json
  "sprint.burndown.title": "Burndown",
  "sprint.burndown.empty": "No burndown data yet",
  "sprint.burndown.remaining": "Remaining",
  "sprint.burndown.ideal": "Ideal",
```

`zh-CN.json`:

```json
  "sprint.burndown.title": "燃尽图",
  "sprint.burndown.empty": "暂无燃尽数据",
  "sprint.burndown.remaining": "剩余",
  "sprint.burndown.ideal": "理想",
```

`zh-TW.json`:

```json
  "sprint.burndown.title": "燃盡圖",
  "sprint.burndown.empty": "尚無燃盡資料",
  "sprint.burndown.remaining": "剩餘",
  "sprint.burndown.ideal": "理想",
```

`ja.json`:

```json
  "sprint.burndown.title": "バーンダウン",
  "sprint.burndown.empty": "バーンダウンのデータはまだありません",
  "sprint.burndown.remaining": "残り",
  "sprint.burndown.ideal": "理想",
```

`ko.json`:

```json
  "sprint.burndown.title": "번다운",
  "sprint.burndown.empty": "아직 번다운 데이터가 없습니다",
  "sprint.burndown.remaining": "남음",
  "sprint.burndown.ideal": "이상",
```

`de.json`:

```json
  "sprint.burndown.title": "Burndown",
  "sprint.burndown.empty": "Noch keine Burndown-Daten",
  "sprint.burndown.remaining": "Verbleibend",
  "sprint.burndown.ideal": "Ideal",
```

`fr.json`:

```json
  "sprint.burndown.title": "Burndown",
  "sprint.burndown.empty": "Aucune donnée de burndown",
  "sprint.burndown.remaining": "Restant",
  "sprint.burndown.ideal": "Idéal",
```

`es.json`, `es-419.json`:

```json
  "sprint.burndown.title": "Burndown",
  "sprint.burndown.empty": "Aún no hay datos de burndown",
  "sprint.burndown.remaining": "Restante",
  "sprint.burndown.ideal": "Ideal",
```

`hi.json`:

```json
  "sprint.burndown.title": "बर्नडाउन",
  "sprint.burndown.empty": "अभी तक कोई बर्नडाउन डेटा नहीं",
  "sprint.burndown.remaining": "शेष",
  "sprint.burndown.ideal": "आदर्श",
```

`id.json`:

```json
  "sprint.burndown.title": "Burndown",
  "sprint.burndown.empty": "Belum ada data burndown",
  "sprint.burndown.remaining": "Tersisa",
  "sprint.burndown.ideal": "Ideal",
```

`ms.json`:

```json
  "sprint.burndown.title": "Burndown",
  "sprint.burndown.empty": "Tiada data burndown lagi",
  "sprint.burndown.remaining": "Baki",
  "sprint.burndown.ideal": "Ideal",
```

`ru.json`:

```json
  "sprint.burndown.title": "Burndown",
  "sprint.burndown.empty": "Пока нет данных burndown",
  "sprint.burndown.remaining": "Осталось",
  "sprint.burndown.ideal": "Идеал",
```

`vi.json`:

```json
  "sprint.burndown.title": "Burndown",
  "sprint.burndown.empty": "Chưa có dữ liệu burndown",
  "sprint.burndown.remaining": "Còn lại",
  "sprint.burndown.ideal": "Lý tưởng",
```

Note on JSON: ensure each insertion keeps valid JSON (commas between entries, no trailing comma at end of object).

- [ ] **Step 3: Verify locale JSON validity + key presence**

Run:

```bash
node -e "const f=require('fs');for(const n of f.readdirSync('lib/i18n')){const j=JSON.parse(f.readFileSync('lib/i18n/'+n));for(const k of ['sprint.burndown.title','sprint.burndown.empty','sprint.burndown.remaining','sprint.burndown.ideal'])if(!(k in j))throw new Error(n+' missing '+k);}console.log('all 16 locales OK')"
```

Expected: `all 16 locales OK`

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useSprints.ts lib/i18n/
git commit -m "feat: useSprintBurndown hook + burndown i18n keys [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: SVG chart component + integration

**Files:**

- Create: `app/workspace/[workspaceUrl]/sprints/components/SprintBurndownChart.tsx`
- Test: `__tests__/components/SprintBurndownChart.test.tsx`
- Modify: `app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx`

- [ ] **Step 1: Write the failing component test**

Create `__tests__/components/SprintBurndownChart.test.tsx`:

```typescript
/** @jest-environment jsdom */

const en: Record<string, string> = {
  'sprint.burndown.title': 'Burndown',
  'sprint.burndown.empty': 'No burndown data yet',
  'sprint.burndown.remaining': 'Remaining',
  'sprint.burndown.ideal': 'Ideal',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

const mockUseSprintBurndown = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintBurndown: (...a: unknown[]) => mockUseSprintBurndown(...a),
}))

import { render, screen } from '@testing-library/react'
import { SprintBurndownChart } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintBurndownChart'

beforeEach(() => mockUseSprintBurndown.mockReset())

test('renders chart with legend and a polyline when data present', () => {
  mockUseSprintBurndown.mockReturnValue({
    burndown: {
      sprintId: 's1',
      start: '2026-06-01',
      end: '2026-06-03',
      unit: 'tasks',
      total: 3,
      series: [
        { date: '2026-06-01', remaining: 3, ideal: 3 },
        { date: '2026-06-02', remaining: 2, ideal: 1.5 },
        { date: '2026-06-03', remaining: 1, ideal: 0 },
      ],
    },
    isLoading: false,
    error: undefined,
  })
  const { container } = render(<SprintBurndownChart sprintId='s1' />)
  expect(screen.getByText('Burndown')).toBeInTheDocument()
  expect(screen.getByText('Remaining')).toBeInTheDocument()
  expect(screen.getByText('Ideal')).toBeInTheDocument()
  // actual line is a polyline; ideal line too → at least 2 polylines
  expect(container.querySelectorAll('polyline').length).toBeGreaterThanOrEqual(2)
})

test('renders empty state when total is 0', () => {
  mockUseSprintBurndown.mockReturnValue({
    burndown: {
      sprintId: 's1',
      start: '2026-06-01',
      end: '2026-06-01',
      unit: 'tasks',
      total: 0,
      series: [{ date: '2026-06-01', remaining: 0, ideal: 0 }],
    },
    isLoading: false,
    error: undefined,
  })
  render(<SprintBurndownChart sprintId='s1' />)
  expect(screen.getByText('No burndown data yet')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/SprintBurndownChart.test.tsx`
Expected: FAIL — cannot find the component module.

- [ ] **Step 3: Write the component**

Create `app/workspace/[workspaceUrl]/sprints/components/SprintBurndownChart.tsx`:

```tsx
'use client'

import { useIntl } from 'react-intl'
import { useSprintBurndown } from '../../hooks/useSprints'

const WIDTH = 288
const HEIGHT = 150
const PAD = { top: 10, right: 10, bottom: 22, left: 24 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className='rounded-lg border border-border p-3'>
      <h3 className='mb-2 text-sm font-medium text-foreground'>{title}</h3>
      {children}
    </div>
  )
}

export function SprintBurndownChart({ sprintId }: { sprintId: string }) {
  const intl = useIntl()
  const { burndown, isLoading } = useSprintBurndown(sprintId)
  const title = intl.formatMessage({ id: 'sprint.burndown.title' })

  if (isLoading || !burndown) {
    return (
      <Card title={title}>
        <div className='h-[120px] animate-pulse rounded bg-muted' />
      </Card>
    )
  }

  const { series, total } = burndown
  if (series.length === 0 || total === 0) {
    return (
      <Card title={title}>
        <p className='py-6 text-center text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'sprint.burndown.empty' })}
        </p>
      </Card>
    )
  }

  const n = series.length
  const maxY = Math.max(total, 1)
  const x = (i: number) =>
    PAD.left + (n === 1 ? PLOT_W / 2 : (PLOT_W * i) / (n - 1))
  const y = (v: number) => PAD.top + PLOT_H - (PLOT_H * v) / maxY

  const idealPoints = series.map((p, i) => `${x(i)},${y(p.ideal)}`).join(' ')
  const actualPoints = series
    .map((p, i) => (p.remaining === null ? null : `${x(i)},${y(p.remaining)}`))
    .filter((s): s is string => s !== null)
    .join(' ')

  return (
    <Card title={title}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className='w-full'
        role='img'
        aria-label={title}
      >
        {/* axes */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + PLOT_H}
          className='stroke-border'
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          className='stroke-border'
          strokeWidth={1}
        />
        {/* ideal (dashed, muted) */}
        <polyline
          points={idealPoints}
          fill='none'
          className='text-muted-foreground'
          stroke='currentColor'
          strokeWidth={1.5}
          strokeDasharray='4 3'
        />
        {/* actual (solid, primary) */}
        <polyline
          points={actualPoints}
          fill='none'
          className='text-primary'
          stroke='currentColor'
          strokeWidth={2}
        />
        {/* y-axis bounds labels */}
        <text
          x={PAD.left - 4}
          y={PAD.top + 4}
          textAnchor='end'
          className='fill-muted-foreground text-[9px]'
        >
          {maxY}
        </text>
        <text
          x={PAD.left - 4}
          y={PAD.top + PLOT_H}
          textAnchor='end'
          className='fill-muted-foreground text-[9px]'
        >
          0
        </text>
      </svg>
      {/* legend */}
      <div className='mt-1 flex items-center gap-4 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-primary' />
          {intl.formatMessage({ id: 'sprint.burndown.remaining' })}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 border-t border-dashed border-muted-foreground' />
          {intl.formatMessage({ id: 'sprint.burndown.ideal' })}
        </span>
      </div>
    </Card>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/SprintBurndownChart.test.tsx`
Expected: PASS — both tests green.

- [ ] **Step 5: Integrate into SprintDetailClient**

In `app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx`:

Add the import (with the other component imports near the top):

```typescript
import { SprintBurndownChart } from '../components/SprintBurndownChart'
```

Then change the `sidePanel` definition (currently `const sidePanel = (<SprintSidebar ... />)`, around lines 147-157) to wrap the sidebar and chart in a scrollable column:

```tsx
const sidePanel = (
  <div className='flex flex-col gap-4 overflow-y-auto'>
    <SprintSidebar
      sprint={sprint}
      progress={progress ?? { done: 0, total: 0 }}
      tasks={localTasks}
      members={members}
      onRefresh={() => {
        refetch()
        refetchTasks()
      }}
    />
    {(sprint.status === 'ACTIVE' || sprint.status === 'CLOSED') && (
      <SprintBurndownChart sprintId={sprint.id} />
    )}
  </div>
)
```

(Keep the exact props currently passed to `SprintSidebar` — copy them verbatim from the existing code; the block above shows the props confirmed during exploration. The DRAFT gate prevents a 409 fetch.)

- [ ] **Step 6: Type-check + token lint**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `npm run lint:tokens`
Expected: PASS (component uses token classes / `currentColor`, no raw hex). If it flags the file, replace any offending literal with a Tailwind token class and re-run.

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/sprints/components/SprintBurndownChart.tsx __tests__/components/SprintBurndownChart.test.tsx app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx
git commit -m "feat: sprint burndown SVG chart + sidebar integration [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full new test set**

Run: `npx jest __tests__/sprint-burndown.test.ts __tests__/sprint-burndown.service.test.ts __tests__/components/SprintBurndownChart.test.tsx`
Expected: all suites PASS.

- [ ] **Step 2: Run the full test suite (catch regressions)**

Run: `npm test`
Expected: no new failures vs. baseline.

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: clean (no new errors). If "TaskActivity not exported" / stale-client errors appear, run `npx prisma generate` first (per project memory), then re-run.

- [ ] **Step 4: Token lint**

Run: `npm run lint:tokens`
Expected: PASS.

- [ ] **Step 5: Manual smoke (optional, if dev server reachable)**

Open a sprint detail page for an ACTIVE or CLOSED sprint; confirm the burndown card renders under the sidebar with an actual line + dashed ideal line, and a DRAFT sprint shows no card. (Per project memory the preview browser may be unreachable; tsc + jsdom tests are the primary gate.)

- [ ] **Step 6: Mark task in review**

```bash
lumo task update LUM-169 --status in_review
```

(Do this only after opening the PR, or leave for the human — see Execution Handoff.)

---

## Self-Review Notes

- **Spec coverage:** ACTIVE+CLOSED (DRAFT gated) ✓; UTC day buckets ✓; backward replay with current-value fallback ✓; candidate set = current ∪ sprint-event-referenced ✓; ideal line linear from `series[0].remaining`→0 ✓; future-day null for ACTIVE ✓; dirty-payload skip ✓; layering pure-fn/repo/service/route/client/hook/component ✓; SVG no new dep ✓; i18n all 16 locales ✓; tests per spec's 10 cases ✓ (mapped into Task 1 suite).
- **Type consistency:** `BurndownComputeInput` / `BurndownSeries` / `SprintBurndownResponse` share the same `{ date, remaining: number|null, ideal }` point shape and `unit: 'tasks'`. `computeBurndownSeries` is the single name used in repo→service→test. `getBurndown` / `useSprintBurndown` / `queryKeys.sprints.burndown` / `API.sprints.burndown` consistent.
- **No CLI/Skill change:** confirmed in spec; `cli/src/commands/` untouched → no SKILL.md update needed.
