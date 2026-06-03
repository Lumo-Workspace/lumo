# Sprint Progress Chart (Burnup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unusable daily-remaining burndown with a Linear-style burnup ("Progress") chart — two cumulative lines (Scope, Completed) plus a projection — reconstructed from the `TaskActivity` stream with no schema change.

**Architecture:** Same layered chain as the burndown it replaces (`Component → api-client → API route → service → repository → Prisma`). The pure function `computeBurnupSeries` holds all the logic and is the primary test surface. All `burndown`-named files are renamed to `burnup` and rewritten; nothing is kept alongside.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess` on, `exactOptionalPropertyTypes` on), Next.js App Router, Prisma v7, react-query, react-intl, hand-written SVG, Jest (SWC).

**Spec:** `docs/superpowers/specs/2026-06-03-sprint-burnup-progress-chart-design.md`

**Working directory:** all commands run from the worktree `.worktrees/LUM-169-sprint-burnup` (jest/tsc must run with cwd inside the worktree — `cd` first).

---

## File Structure

**Create:**
- `lib/services/sprint-burnup.ts` — pure `computeBurnupSeries` + types
- `lib/services/sprint-burnup.service.ts` — orchestration (repo + sprint lookup)
- `lib/repositories/sprint-burnup.repository.ts` — candidate-set + activity load (adds `createdAt`)
- `app/api/sprints/[sprintId]/burnup/route.ts` — thin GET route
- `app/workspace/[workspaceUrl]/sprints/components/SprintProgressChart.tsx` — SVG component
- `__tests__/sprint-burnup.test.ts` — pure-function tests

**Modify:**
- `lib/api-client/sprints.ts` — swap `SprintBurndownResponse`/`getBurndown` → burnup
- `app/workspace/[workspaceUrl]/constants.ts:136` — `API.sprints.burndown` → `burnup`
- `lib/query/keys.ts:50` — `sprints.burndown` → `sprints.burnup`
- `app/workspace/[workspaceUrl]/hooks/useSprints.ts:270-296` — `useSprintBurndown` → `useSprintBurnup`
- `app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx:14,163` — swap component
- `lib/i18n/*.json` (16 files) — replace `sprint.burndown.*` (4 keys) with `sprint.burnup.*` (5 keys)

**Delete (Task 10):**
- `lib/services/sprint-burndown.ts`
- `lib/services/sprint-burndown.service.ts`
- `lib/repositories/sprint-burndown.repository.ts`
- `app/api/sprints/[sprintId]/burndown/route.ts` (and the now-empty `burndown/` dir)
- `app/workspace/[workspaceUrl]/sprints/components/SprintBurndownChart.tsx`
- `__tests__/sprint-burndown.test.ts`

---

## Task 1: Pure function `computeBurnupSeries` (types + skeleton)

**Files:**
- Create: `lib/services/sprint-burnup.ts`
- Test: `__tests__/sprint-burnup.test.ts`

- [ ] **Step 1: Write the test scaffolding + first failing test**

Create `__tests__/sprint-burnup.test.ts`:

```ts
import { computeBurnupSeries } from '@/lib/services/sprint-burnup'
import type { BurnupComputeInput } from '@/lib/services/sprint-burnup'

const SPRINT = 'sprint-1'
const at = (d: string) => new Date(`${d}T12:00:00.000Z`)

function statusEvt(taskId: string, from: string, to: string, d: string) {
  return { taskId, type: 'STATUS_CHANGED' as const, payload: { from, to }, createdAt: at(d) }
}
function sprintEvt(
  taskId: string,
  from: string | null,
  to: string | null,
  d: string
) {
  return {
    taskId,
    type: 'SPRINT_CHANGED' as const,
    payload: { fromSprintId: from, toSprintId: to },
    createdAt: at(d),
  }
}
function baseInput(over: Partial<BurnupComputeInput> = {}): BurnupComputeInput {
  return {
    sprintId: SPRINT,
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    startedAt: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-03T00:00:00.000Z'),
    status: 'CLOSED',
    now: new Date('2026-06-10T00:00:00.000Z'),
    tasks: [],
    activities: [],
    ...over,
  }
}

describe('computeBurnupSeries', () => {
  test('smooth burnup: scope and completed both rise; completed <= scope', () => {
    const out = computeBurnupSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'DONE', createdAt: at('2026-06-01') },
          { id: 't2', sprintId: SPRINT, status: 'DONE', createdAt: at('2026-06-01') },
          { id: 't3', sprintId: SPRINT, status: 'DONE', createdAt: at('2026-06-02') },
          { id: 't4', sprintId: SPRINT, status: 'TODO', createdAt: at('2026-06-03') },
        ],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-01'),
          statusEvt('t2', 'TODO', 'DONE', '2026-06-02'),
          statusEvt('t3', 'TODO', 'DONE', '2026-06-03'),
        ],
      })
    )
    expect(out.unit).toBe('tasks')
    expect(out.scopeTotal).toBe(4)
    expect(out.series.map(p => p.scope)).toEqual([2, 3, 4])
    expect(out.series.map(p => p.completed)).toEqual([1, 2, 3])
    expect(out.series.map(p => p.projected)).toEqual([null, null, null])
    // invariant
    for (const p of out.series) expect(p.completed! <= p.scope).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/LUM-169-sprint-burnup && npx jest sprint-burnup -t "smooth burnup"`
Expected: FAIL — `Cannot find module '@/lib/services/sprint-burnup'`.

- [ ] **Step 3: Write the types + helpers + skeleton**

Create `lib/services/sprint-burnup.ts`:

```ts
import type { TaskStatus } from '@prisma/client'

export interface BurnupTaskInput {
  id: string
  sprintId: string | null
  status: TaskStatus
  createdAt: Date
}

export interface BurnupActivityInput {
  taskId: string
  type: 'STATUS_CHANGED' | 'SPRINT_CHANGED'
  payload: unknown
  createdAt: Date
}

export interface BurnupComputeInput {
  sprintId: string
  startDate: Date
  /** When the sprint actually transitioned DRAFT→ACTIVE. Window starts here (falls back to startDate when null) so pre-start empty days don't dominate. */
  startedAt?: Date | null
  endDate: Date
  status: 'ACTIVE' | 'CLOSED'
  now: Date
  tasks: BurnupTaskInput[]
  activities: BurnupActivityInput[]
}

export interface BurnupPoint {
  date: string
  /** Committed work known by end-of-day: candidates created on or before this day. */
  scope: number
  /** Candidates DONE at end-of-day. null for future days of an ACTIVE sprint. */
  completed: number | null
  /** Projection segment only: linear from today's completed to (end, scopeTotal). null elsewhere. */
  projected: number | null
}

export interface BurnupSeries {
  sprintId: string
  start: string
  end: string
  unit: 'tasks'
  /** Final scope = y-axis max. */
  scopeTotal: number
  series: BurnupPoint[]
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
  // Cast unchecked: only `=== 'DONE'` is compared downstream, so an unexpected
  // enum value safely counts as "not done" rather than throwing.
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
  return { fromSprintId: from as string | null, toSprintId: to as string | null }
}

/** State of a step-function at time tMs: last event whose createdAt <= tMs. */
function statusAt(events: StatusEvt[], tMs: number, fallback: TaskStatus): TaskStatus {
  const first = events[0]
  if (!first) return fallback
  let chosen: StatusEvt | null = null
  for (const e of events) {
    if (e.createdAt.getTime() <= tMs) chosen = e
    else break
  }
  return chosen ? chosen.to : first.from
}

export function computeBurnupSeries(input: BurnupComputeInput): BurnupSeries {
  const { sprintId, startDate, startedAt, endDate, status, now, tasks, activities } =
    input
  const effectiveStart = startedAt ?? startDate

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
    if (evts.some(e => e.fromSprintId === sprintId || e.toSprintId === sprintId)) {
      candidates.add(taskId)
    }
  }

  /** Candidates created on or before eodMs. */
  function countScope(eodMs: number): number {
    let count = 0
    for (const id of candidates) {
      const created = taskById.get(id)?.createdAt.getTime()
      if (created !== undefined && created <= eodMs) count++
    }
    return count
  }
  /** Candidates created on or before eodMs AND DONE at eodMs. Always <= countScope. */
  function countCompleted(eodMs: number): number {
    let count = 0
    for (const id of candidates) {
      const t = taskById.get(id)
      if (!t || t.createdAt.getTime() > eodMs) continue
      if (statusAt(statusByTask.get(id) ?? [], eodMs, t.status) === 'DONE') count++
    }
    return count
  }

  const days = enumerateUtcDays(effectiveStart, endDate)
  const firstDay = days[0]
  if (!firstDay) {
    return {
      sprintId,
      start: toUtcDateKey(effectiveStart),
      end: toUtcDateKey(endDate),
      unit: 'tasks',
      scopeTotal: 0,
      series: [],
    }
  }
  const lastDay = days[days.length - 1] ?? firstDay
  const nowMs = now.getTime()
  const n = days.length
  const scopeTotal = countScope(utcMidnight(lastDay) + DAY_MS - 1)

  const series: BurnupPoint[] = days.map(day => {
    const eod = utcMidnight(day) + DAY_MS - 1
    const isFuture = utcMidnight(day) > nowMs
    const scope = countScope(eod)
    const completed = status === 'ACTIVE' && isFuture ? null : countCompleted(eod)
    return { date: toUtcDateKey(day), scope, completed, projected: null }
  })

  if (status === 'ACTIVE') {
    // Last day that is not in the future = the anchor for the projection.
    let lastActualIdx = -1
    for (let i = 0; i < n; i++) {
      const d = days[i]
      if (d && utcMidnight(d) <= nowMs) lastActualIdx = i
    }
    const anchor = lastActualIdx >= 0 ? series[lastActualIdx] : undefined
    if (anchor && anchor.completed !== null && lastActualIdx < n - 1) {
      const startVal = anchor.completed
      const span = n - 1 - lastActualIdx
      for (let i = lastActualIdx; i < n; i++) {
        const p = series[i]
        if (!p) continue
        const v = startVal + ((scopeTotal - startVal) * (i - lastActualIdx)) / span
        p.projected = Math.round(v * 100) / 100
      }
    }
  }

  return {
    sprintId,
    start: toUtcDateKey(firstDay),
    end: toUtcDateKey(lastDay),
    unit: 'tasks',
    scopeTotal,
    series,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .worktrees/LUM-169-sprint-burnup && npx jest sprint-burnup -t "smooth burnup"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add lib/services/sprint-burnup.ts __tests__/sprint-burnup.test.ts
git commit -m "feat: computeBurnupSeries pure function + first test [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Pure function — remaining test cases

**Files:**
- Modify: `__tests__/sprint-burnup.test.ts`

- [ ] **Step 1: Add the failing tests** (append inside the `describe` block, before its closing `})`)

```ts
  test('ACTIVE: future days null; projection linear from today to (end, scopeTotal)', () => {
    const out = computeBurnupSeries(
      baseInput({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        startedAt: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-04T00:00:00.000Z'),
        status: 'ACTIVE',
        now: new Date('2026-06-02T06:00:00.000Z'), // 06-01, 06-02 past; 06-03, 06-04 future
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'DONE', createdAt: at('2026-06-01') },
          { id: 't2', sprintId: SPRINT, status: 'TODO', createdAt: at('2026-06-01') },
        ],
        activities: [statusEvt('t1', 'TODO', 'DONE', '2026-06-01')],
      })
    )
    expect(out.scopeTotal).toBe(2)
    expect(out.series.map(p => p.scope)).toEqual([2, 2, 2, 2])
    expect(out.series.map(p => p.completed)).toEqual([1, 1, null, null])
    // anchor at idx 1 (06-02, completed=1) → (idx3, 2); idx2 = 1.5
    expect(out.series.map(p => p.projected)).toEqual([null, 1, 1.5, 2])
  })

  test('reopen (DONE→TODO) makes completed dip and stay <= scope', () => {
    const out = computeBurnupSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'TODO', createdAt: at('2026-06-01') },
        ],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-01'),
          statusEvt('t1', 'DONE', 'TODO', '2026-06-02'),
        ],
      })
    )
    expect(out.series.map(p => p.scope)).toEqual([1, 1, 1])
    expect(out.series.map(p => p.completed)).toEqual([1, 0, 0])
  })

  test('startedAt anchoring: pre-startedAt days are dropped', () => {
    const out = computeBurnupSeries(
      baseInput({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        startedAt: new Date('2026-06-03T00:00:00.000Z'),
        endDate: new Date('2026-06-05T00:00:00.000Z'),
        status: 'CLOSED',
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'TODO', createdAt: at('2026-06-03') },
        ],
      })
    )
    expect(out.start).toBe('2026-06-03')
    expect(out.series.map(p => p.date)).toEqual(['2026-06-03', '2026-06-04', '2026-06-05'])
  })

  test('candidate added mid-sprint via SPRINT_CHANGED still counts; scope tracks createdAt', () => {
    const out = computeBurnupSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'DONE', createdAt: at('2026-06-01') },
          // t5 currently in another sprint, but a SPRINT_CHANGED referenced SPRINT
          { id: 't5', sprintId: 'other', status: 'DONE', createdAt: at('2026-06-01') },
        ],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-01'),
          sprintEvt('t5', null, SPRINT, '2026-06-02'),
          statusEvt('t5', 'TODO', 'DONE', '2026-06-02'),
          sprintEvt('t5', SPRINT, 'other', '2026-06-03'),
        ],
      })
    )
    // both t1 and t5 are candidates; scope counts by createdAt (both 06-01)
    expect(out.scopeTotal).toBe(2)
    expect(out.series.map(p => p.scope)).toEqual([2, 2, 2])
    expect(out.series.map(p => p.completed)).toEqual([1, 2, 2])
  })

  test('empty sprint: scopeTotal 0, completed all 0', () => {
    const out = computeBurnupSeries(baseInput({ tasks: [], activities: [] }))
    expect(out.scopeTotal).toBe(0)
    expect(out.series.map(p => p.scope)).toEqual([0, 0, 0])
    expect(out.series.map(p => p.completed)).toEqual([0, 0, 0])
  })

  test('effectiveStart after endDate yields empty series', () => {
    const out = computeBurnupSeries(
      baseInput({
        startedAt: new Date('2026-06-10T00:00:00.000Z'),
        endDate: new Date('2026-06-03T00:00:00.000Z'),
      })
    )
    expect(out.series).toEqual([])
    expect(out.scopeTotal).toBe(0)
  })
```

- [ ] **Step 2: Run the full file to verify all pass**

Run: `cd .worktrees/LUM-169-sprint-burnup && npx jest sprint-burnup`
Expected: PASS — 7 tests.

- [ ] **Step 3: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add __tests__/sprint-burnup.test.ts
git commit -m "test: cover burnup projection, reopen, anchoring, mid-sprint, empty [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Repository `sprint-burnup.repository.ts`

**Files:**
- Create: `lib/repositories/sprint-burnup.repository.ts`

Note: identical to the burndown repository except the task `select` adds `createdAt: true` and the input type carries it. No new unit test (Prisma access; covered by the existing repository pattern and the route).

- [ ] **Step 1: Create the repository**

```ts
import { prisma } from '@/lib/db/prisma'
import type { TaskStatus } from '@prisma/client'

export interface BurnupInputs {
  tasks: Array<{
    id: string
    sprintId: string | null
    status: TaskStatus
    createdAt: Date
  }>
  activities: Array<{
    taskId: string
    type: 'STATUS_CHANGED' | 'SPRINT_CHANGED'
    payload: unknown
    createdAt: Date
  }>
}

export const sprintBurnupRepository = {
  /**
   * Load the candidate task set + their status/sprint activity timelines.
   * Candidates = tasks currently in the sprint ∪ tasks with any SPRINT_CHANGED
   * whose payload from/to references this sprint (i.e. tasks that left it).
   */
  async loadInputs(sprintId: string): Promise<BurnupInputs> {
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
      select: { id: true, sprintId: true, status: true, createdAt: true },
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
      activities: activities as unknown as BurnupInputs['activities'],
    }
  },
}
```

- [ ] **Step 2: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add lib/repositories/sprint-burnup.repository.ts
git commit -m "feat: sprint-burnup repository loads candidates + createdAt [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Service `sprint-burnup.service.ts`

**Files:**
- Create: `lib/services/sprint-burnup.service.ts`

- [ ] **Step 1: Create the service**

```ts
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { sprintBurnupRepository } from '@/lib/repositories/sprint-burnup.repository'
import {
  computeBurnupSeries,
  type BurnupSeries,
} from '@/lib/services/sprint-burnup'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export const sprintBurnupService = {
  async compute(sprintId: string, now: Date): Promise<BurnupSeries> {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (sprint.status === 'DRAFT') httpError(409, 'sprint not started')

    const { tasks, activities } =
      await sprintBurnupRepository.loadInputs(sprintId)

    return computeBurnupSeries({
      sprintId,
      startDate: sprint.startDate,
      startedAt: sprint.startedAt,
      endDate: sprint.endDate,
      status: sprint.status as 'ACTIVE' | 'CLOSED',
      now,
      tasks,
      activities,
    })
  },
}
```

- [ ] **Step 2: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add lib/services/sprint-burnup.service.ts
git commit -m "feat: sprint-burnup service orchestration [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: API route `burnup/route.ts`

**Files:**
- Create: `app/api/sprints/[sprintId]/burnup/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'
import { sprintBurnupService } from '@/lib/services/sprint-burnup.service'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * GET /api/sprints/[sprintId]/burnup — Reconstructed scope/completed/projected
 * series for a sprint.
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

    const data = await sprintBurnupService.compute(sprintId, new Date())
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add app/api/sprints/\[sprintId\]/burnup/route.ts
git commit -m "feat: GET /api/sprints/[id]/burnup route [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: api-client + constants + query keys

**Files:**
- Modify: `lib/api-client/sprints.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts:136`
- Modify: `lib/query/keys.ts:50`

- [ ] **Step 1: Update `lib/api-client/sprints.ts`**

Replace the `SprintBurndownResponse` interface (currently L24-31) with:

```ts
export interface SprintBurnupResponse {
  sprintId: string
  start: string
  end: string
  unit: 'tasks'
  scopeTotal: number
  series: Array<{
    date: string
    scope: number
    completed: number | null
    projected: number | null
  }>
}
```

Replace the `getBurndown` method (currently L111-113) with:

```ts
  getBurnup(sprintId: string) {
    return apiFetch<SprintBurnupResponse>(API.sprints.burnup(sprintId))
  },
```

- [ ] **Step 2: Update `app/workspace/[workspaceUrl]/constants.ts:136`**

Replace:

```ts
    burndown: (sprintId: string) => `/api/sprints/${sprintId}/burndown`,
```

with:

```ts
    burnup: (sprintId: string) => `/api/sprints/${sprintId}/burnup`,
```

- [ ] **Step 3: Update `lib/query/keys.ts:50`**

Replace:

```ts
    burndown: (sprintId: string) => ['sprints', 'burndown', sprintId] as const,
```

with:

```ts
    burnup: (sprintId: string) => ['sprints', 'burnup', sprintId] as const,
```

- [ ] **Step 4: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add lib/api-client/sprints.ts app/workspace/\[workspaceUrl\]/constants.ts lib/query/keys.ts
git commit -m "feat: burnup api-client, route constant, query key [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Hook `useSprintBurnup`

**Files:**
- Modify: `app/workspace/[workspaceUrl]/hooks/useSprints.ts:11,270-296`

- [ ] **Step 1: Update the import (L11)**

Replace `import type { SprintBurndownResponse } from '@/lib/api-client/sprints'`
with `import type { SprintBurnupResponse } from '@/lib/api-client/sprints'`.

- [ ] **Step 2: Replace the hook block (L270-296)**

```ts
// ---------------------------------------------------------------------------
// useSprintBurnup
// ---------------------------------------------------------------------------

/**
 * Fetches the reconstructed burnup (scope/completed/projected) series for a sprint.
 * Returns { burnup, isLoading, error }.
 */
export function useSprintBurnup(sprintId: string | null) {
  const query = useQuery<SprintBurnupResponse | null>({
    queryKey: sprintId
      ? queryKeys.sprints.burnup(sprintId)
      : ['sprints', 'burnup', 'disabled'],
    queryFn: async () => {
      const res = await sprintsClient.getBurnup(sprintId as string)
      return res ?? null
    },
    enabled: !!sprintId,
  })

  return {
    burnup: query.data ?? null,
    isLoading: query.isPending && !!sprintId,
    error: query.error ?? undefined,
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add app/workspace/\[workspaceUrl\]/hooks/useSprints.ts
git commit -m "feat: useSprintBurnup hook [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: i18n keys (all 16 locales)

**Files:**
- Modify: `lib/i18n/*.json` (16 files)

In each file, the four `sprint.burndown.*` keys appear as a contiguous block. Replace that block with the five `sprint.burnup.*` keys below for that locale, preserving the existing indentation (2 spaces) and the trailing comma after the last key.

- [ ] **Step 1: Replace the block in every locale file**

```
en.json / en-AU.json / en-GB.json:
  "sprint.burnup.title": "Progress",
  "sprint.burnup.empty": "No progress data yet",
  "sprint.burnup.scope": "Scope",
  "sprint.burnup.completed": "Completed",
  "sprint.burnup.projected": "Projected",

de.json:
  "sprint.burnup.title": "Fortschritt",
  "sprint.burnup.empty": "Noch keine Fortschrittsdaten",
  "sprint.burnup.scope": "Umfang",
  "sprint.burnup.completed": "Abgeschlossen",
  "sprint.burnup.projected": "Prognose",

es.json / es-419.json:
  "sprint.burnup.title": "Progreso",
  "sprint.burnup.empty": "Aún no hay datos de progreso",
  "sprint.burnup.scope": "Alcance",
  "sprint.burnup.completed": "Completado",
  "sprint.burnup.projected": "Proyectado",

fr.json:
  "sprint.burnup.title": "Progression",
  "sprint.burnup.empty": "Aucune donnée de progression",
  "sprint.burnup.scope": "Périmètre",
  "sprint.burnup.completed": "Terminé",
  "sprint.burnup.projected": "Projeté",

hi.json:
  "sprint.burnup.title": "प्रगति",
  "sprint.burnup.empty": "अभी तक कोई प्रगति डेटा नहीं",
  "sprint.burnup.scope": "दायरा",
  "sprint.burnup.completed": "पूर्ण",
  "sprint.burnup.projected": "अनुमानित",

id.json:
  "sprint.burnup.title": "Progres",
  "sprint.burnup.empty": "Belum ada data progres",
  "sprint.burnup.scope": "Lingkup",
  "sprint.burnup.completed": "Selesai",
  "sprint.burnup.projected": "Proyeksi",

ja.json:
  "sprint.burnup.title": "進捗",
  "sprint.burnup.empty": "進捗データはまだありません",
  "sprint.burnup.scope": "スコープ",
  "sprint.burnup.completed": "完了",
  "sprint.burnup.projected": "予測",

ko.json:
  "sprint.burnup.title": "진행 상황",
  "sprint.burnup.empty": "아직 진행 데이터가 없습니다",
  "sprint.burnup.scope": "범위",
  "sprint.burnup.completed": "완료",
  "sprint.burnup.projected": "예상",

ms.json:
  "sprint.burnup.title": "Kemajuan",
  "sprint.burnup.empty": "Tiada data kemajuan lagi",
  "sprint.burnup.scope": "Skop",
  "sprint.burnup.completed": "Selesai",
  "sprint.burnup.projected": "Unjuran",

ru.json:
  "sprint.burnup.title": "Прогресс",
  "sprint.burnup.empty": "Пока нет данных о прогрессе",
  "sprint.burnup.scope": "Объём",
  "sprint.burnup.completed": "Завершено",
  "sprint.burnup.projected": "Прогноз",

vi.json:
  "sprint.burnup.title": "Tiến độ",
  "sprint.burnup.empty": "Chưa có dữ liệu tiến độ",
  "sprint.burnup.scope": "Phạm vi",
  "sprint.burnup.completed": "Hoàn thành",
  "sprint.burnup.projected": "Dự kiến",

zh-CN.json:
  "sprint.burnup.title": "进度",
  "sprint.burnup.empty": "暂无进度数据",
  "sprint.burnup.scope": "范围",
  "sprint.burnup.completed": "完成",
  "sprint.burnup.projected": "预测",

zh-TW.json:
  "sprint.burnup.title": "進度",
  "sprint.burnup.empty": "尚無進度資料",
  "sprint.burnup.scope": "範圍",
  "sprint.burnup.completed": "完成",
  "sprint.burnup.projected": "預測",
```

- [ ] **Step 2: Verify no `sprint.burndown` keys remain and JSON is valid**

Run: `cd .worktrees/LUM-169-sprint-burnup && grep -rl "sprint.burndown" lib/i18n/ ; for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"; done`
Expected: no output from grep; no `INVALID:` lines.

- [ ] **Step 3: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add lib/i18n
git commit -m "i18n: replace sprint.burndown keys with sprint.burnup (16 locales) [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: UI component `SprintProgressChart`

**Files:**
- Create: `app/workspace/[workspaceUrl]/sprints/components/SprintProgressChart.tsx`
- Modify: `app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx:14,163`

Two colors only: `muted-foreground` (scope) and `primary` (completed solid + projected dashed). y-axis max = `scopeTotal`. Scope/completed solid polylines built from non-null points; projected dashed from its non-null points.

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useIntl } from 'react-intl'
import { useSprintBurnup } from '../../hooks/useSprints'

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

export function SprintProgressChart({ sprintId }: { sprintId: string }) {
  const intl = useIntl()
  const { burnup, isLoading } = useSprintBurnup(sprintId)
  const title = intl.formatMessage({ id: 'sprint.burnup.title' })

  if (isLoading || !burnup) {
    return (
      <Card title={title}>
        <div className='h-[120px] animate-pulse rounded bg-muted' />
      </Card>
    )
  }

  const { series, scopeTotal } = burnup
  if (series.length === 0 || scopeTotal === 0) {
    return (
      <Card title={title}>
        <p className='py-6 text-center text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'sprint.burnup.empty' })}
        </p>
      </Card>
    )
  }

  const n = series.length
  const maxY = Math.max(scopeTotal, 1)
  const x = (i: number) =>
    PAD.left + (n === 1 ? PLOT_W / 2 : (PLOT_W * i) / (n - 1))
  const y = (v: number) => PAD.top + PLOT_H - (PLOT_H * v) / maxY

  const line = (pick: (p: (typeof series)[number]) => number | null) =>
    series
      .map((p, i) => {
        const v = pick(p)
        return v === null ? null : `${x(i)},${y(v)}`
      })
      .filter((s): s is string => s !== null)
      .join(' ')

  const scopePoints = line(p => p.scope)
  const completedPoints = line(p => p.completed)
  const projectedPoints = line(p => p.projected)

  return (
    <Card title={title}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className='w-full'
        role='img'
        aria-label={title}
      >
        <title>{title}</title>
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
        <polyline
          points={scopePoints}
          fill='none'
          className='text-muted-foreground'
          stroke='currentColor'
          strokeWidth={1.5}
        />
        <polyline
          points={projectedPoints}
          fill='none'
          className='text-primary'
          stroke='currentColor'
          strokeWidth={1.5}
          strokeDasharray='4 3'
        />
        <polyline
          points={completedPoints}
          fill='none'
          className='text-primary'
          stroke='currentColor'
          strokeWidth={2}
        />
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
      <div className='mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-muted-foreground' />
          {intl.formatMessage({ id: 'sprint.burnup.scope' })}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-primary' />
          {intl.formatMessage({ id: 'sprint.burnup.completed' })}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 border-t border-dashed border-primary' />
          {intl.formatMessage({ id: 'sprint.burnup.projected' })}
        </span>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Wire it into `SprintDetailClient.tsx`**

Replace the import on L14:

```tsx
import { SprintBurndownChart } from '../components/SprintBurndownChart'
```

with:

```tsx
import { SprintProgressChart } from '../components/SprintProgressChart'
```

Replace the render on L163:

```tsx
        <SprintBurndownChart sprintId={sprint.id} />
```

with:

```tsx
        <SprintProgressChart sprintId={sprint.id} />
```

- [ ] **Step 3: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add app/workspace/\[workspaceUrl\]/sprints/components/SprintProgressChart.tsx app/workspace/\[workspaceUrl\]/sprints/\[sprintId\]/SprintDetailClient.tsx
git commit -m "feat: SprintProgressChart (scope/completed/projected SVG) [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Remove the burndown files + full verification

**Files:**
- Delete: the 6 burndown files listed in File Structure.

- [ ] **Step 1: Delete the old burndown files**

```bash
cd .worktrees/LUM-169-sprint-burnup
git rm lib/services/sprint-burndown.ts \
       lib/services/sprint-burndown.service.ts \
       lib/repositories/sprint-burndown.repository.ts \
       app/api/sprints/\[sprintId\]/burndown/route.ts \
       app/workspace/\[workspaceUrl\]/sprints/components/SprintBurndownChart.tsx \
       __tests__/sprint-burndown.test.ts
```

- [ ] **Step 2: Confirm no lingering burndown references**

Run: `cd .worktrees/LUM-169-sprint-burnup && grep -rni "burndown" app components lib __tests__ --include="*.ts" --include="*.tsx" --include="*.json"`
Expected: no output. (If any appear, fix them before continuing.)

- [ ] **Step 3: Run the full unit-test file**

Run: `cd .worktrees/LUM-169-sprint-burnup && npx jest sprint-burnup`
Expected: PASS — 7 tests.

- [ ] **Step 4: Typecheck + token lint**

Run `npx prisma generate` first (the repository select changed; ensures the client is current per the project's known stale-client gotcha), then:

```bash
cd .worktrees/LUM-169-sprint-burnup
npx prisma generate
npx tsc --noEmit
npm run lint:tokens
```

Expected: `tsc` exits 0; `lint:tokens` passes (the component uses only `primary`/`muted-foreground`/`border` tokens, no raw hex, so no baseline change is expected).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-169-sprint-burnup
git add -A
git commit -m "chore: remove burndown, replaced by burnup progress chart [LUM-169]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Real-data delivery gate (manual — NOT committed)

The hard lesson of this task: green unit tests did not prove the burndown worked. Before flipping LUM-169 to done, prove the burnup is meaningful on **prod Sprint 4**.

- [ ] **Step 1: Write a throwaway validation script** at `scripts/verify-burnup.ts` that imports `{ prisma }` from `../lib/db/prisma` and `{ computeBurnupSeries }` from `../lib/services/sprint-burnup`, replicates `sprintBurnupRepository.loadInputs` (it must `select` `createdAt`), loads the ACTIVE sprint, and prints `scopeTotal`, the `scope`/`completed`/`projected` arrays. (Pattern: the verify scripts used during design; reuse the loadInputs body verbatim.)

- [ ] **Step 2: Run it read-only against prod**

```bash
cd .worktrees/LUM-169-sprint-burnup
export $(grep -E '^DATABASE_URL=' /Users/chaoli/Desktop/lumo/lumo/.env.production | xargs)
NODE_ENV=production npx tsx scripts/verify-burnup.ts
```

Expected on Sprint 4: `scope` ≈ `[29, 40, 54]`, `completed` ≈ `[19, 33, 53]`, `completed[i] ≤ scope[i]` everywhere, and (ACTIVE) a non-null `projected` segment ending at `scopeTotal`. Confirm the curve is a real rising burnup, not a flat line.

- [ ] **Step 3: Delete the throwaway script** (do not commit it)

```bash
cd .worktrees/LUM-169-sprint-burnup && rm -f scripts/verify-burnup.ts
```

- [ ] **Step 4: Open the PR** with title `feat: sprint burnup (progress chart) replacing burndown [LUM-169]`, describing: no schema change, no new deps, burndown endpoint `/api/sprints/[id]/burndown` removed and replaced by `/burnup` (note for any external callers), and the prod Sprint 4 validation numbers. Keep LUM-169 in `IN_REVIEW` until the PR lands on `origin/main`, then `done`.

---

## Self-Review notes (resolved)

- **Spec coverage:** model (Pairing X) → Task 1/2; projection → Task 1 + test in Task 2; startedAt anchoring → Task 1 + test; layered chain → Tasks 3-7; UI two-color → Task 8/9; i18n every locale → Task 8; real-data gate → Task 11; accepted simplifications (pre-join completions counted, scope doesn't shrink on removal) are inherent to the candidate-set + createdAt logic in Task 1 and asserted by the mid-sprint test in Task 2.
- **Type consistency:** `computeBurnupSeries`, `BurnupComputeInput`, `BurnupSeries`, `BurnupPoint` (`scope`/`completed`/`projected`), `scopeTotal`, `sprintBurnupRepository.loadInputs`, `sprintBurnupService.compute`, `getBurnup`, `SprintBurnupResponse`, `queryKeys.sprints.burnup`, `API.sprints.burnup`, `useSprintBurnup` (returns `{ burnup }`), `SprintProgressChart` — names match across all tasks.
- **`completed: number | null`** is declared as a union (not optional) so `exactOptionalPropertyTypes` is satisfied; future-day nulls are explicit values, not missing keys.
