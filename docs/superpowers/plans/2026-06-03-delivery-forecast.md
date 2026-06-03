# Delivery Forecast Implementation Plan [LUM-171]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a task's detail page, show a delivery forecast — predicted iterations / merged PRs / cycle time as p25–median–p75 intervals — retrieved deterministically from similar completed tasks' real agent-execution data.

**Architecture:** Pure functions (scoring, metric extraction, percentiles) compose under a thin service that calls one repository query. No LLM, no schema change, no persistence. A lazy-loaded React Query hook feeds a read-only panel rendered at the bottom of the task detail sidebar. Layering: Component → Hook → API Client → API Route → Service → Repository → Prisma.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Prisma, TanStack Query, react-intl, Jest (SWC).

**Working directory:** This plan executes in the worktree `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171` on branch `lumo/LUM-171-delivery-forecast`. **Always `cd` into the worktree before running jest/tsc** (jest from the main checkout hits a cli/package.json haste collision and runs the wrong tree).

**Spec:** `docs/superpowers/specs/2026-06-03-delivery-forecast-design.md`

---

## File Structure

**Create (pure domain — `lib/forecast/`):**
- `lib/forecast/types.ts` — shared types (`Interval`, `ForecastCandidate`, `ForecastInputs`, `CandidateMetrics`, `ForecastSource`, `TaskForecast`)
- `lib/forecast/percentile.ts` — `percentile()`, `interval()`
- `lib/forecast/metrics.ts` — `extractMetrics()`
- `lib/forecast/score.ts` — `tagJaccard()`, `scoreCandidate()`

**Create (data + orchestration):**
- `lib/repositories/forecast.repository.ts` — `forecastRepository.loadForecastInputs()`
- `lib/services/forecast.service.ts` — `forecastService.getTaskForecast()`
- `app/api/tasks/[id]/forecast/route.ts` — GET handler

**Create (frontend):**
- `app/workspace/[workspaceUrl]/hooks/useTaskForecast.ts`
- `app/workspace/[workspaceUrl]/components/ForecastPanel.tsx`

**Modify:**
- `lib/services/index.ts` — export `forecastService`
- `lib/api-client/tasks.ts` — add `forecast()`
- `app/workspace/[workspaceUrl]/constants.ts` — add `API.tasks.forecast`
- `lib/query/keys.ts` — add `queryKeys.tasks.forecast`
- `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx` — render `<ForecastPanel>` at the end
- All 16 files in `lib/i18n/*.json` — add `forecast.*` keys

**Create (tests):**
- `__tests__/lib/forecast/percentile.test.ts`
- `__tests__/lib/forecast/metrics.test.ts`
- `__tests__/lib/forecast/score.test.ts`
- `__tests__/repositories/forecast.repository.test.ts`
- `__tests__/services/forecast.service.test.ts`

---

## Task 1: Shared types + percentile util

**Files:**
- Create: `lib/forecast/types.ts`
- Create: `lib/forecast/percentile.ts`
- Test: `__tests__/lib/forecast/percentile.test.ts`

- [ ] **Step 1: Create the types file**

`lib/forecast/types.ts`:
```ts
/** p25 / median / p75 over a numeric sample. */
export interface Interval {
  p25: number
  median: number
  p75: number
}

/** One completed candidate task as loaded from the DB (raw, pre-metrics). */
export interface ForecastCandidate {
  id: string
  title: string
  identifier: string // `${team.identifier}-${number}`, e.g. "LUM-42"
  tags: string[]
  agentRuns: { startedAt: Date; finishedAt: Date | null }[]
  mergedPrAt: (Date | null)[] // mergedAt of each merged PR
}

export interface ForecastInputs {
  target: { id: string; title: string; tags: string[]; projectId: string }
  candidates: ForecastCandidate[]
}

/** Metrics extracted from one candidate. */
export interface CandidateMetrics {
  iterations: number
  mergedPrs: number
  cycleHours: number | null
}

/** A historical task that contributed to the interval (explainability). */
export interface ForecastSource {
  taskId: string
  identifier: string
  title: string
  iterations: number
  mergedPrs: number
  cycleHours: number | null
  score: number
}

export interface TaskForecast {
  insufficientData: boolean
  cohortSize: number
  iterations: Interval | null
  mergedPrs: Interval | null
  cycleHours: Interval | null
  sources: ForecastSource[]
}
```

- [ ] **Step 2: Write the failing test**

`__tests__/lib/forecast/percentile.test.ts`:
```ts
import { percentile, interval } from '@/lib/forecast/percentile'

describe('percentile', () => {
  it('returns the single value for a one-element sample', () => {
    expect(percentile([5], 0.25)).toBe(5)
    expect(percentile([5], 0.5)).toBe(5)
    expect(percentile([5], 0.75)).toBe(5)
  })

  it('computes linear-interpolated quantiles', () => {
    // sample 1..5: pos for p25 = (5-1)*0.25 = 1 → value 2
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2)
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5], 0.75)).toBe(4)
  })

  it('interpolates between ranks', () => {
    // [1,2,3,4]: p25 pos = 3*0.25 = 0.75 → 1 + (2-1)*0.75 = 1.75
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75)
  })

  it('sorts unsorted input', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
  })

  it('throws on empty input', () => {
    expect(() => percentile([], 0.5)).toThrow()
  })
})

describe('interval', () => {
  it('returns p25/median/p75', () => {
    expect(interval([1, 2, 3, 4, 5])).toEqual({ p25: 2, median: 3, p75: 4 })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/lib/forecast/percentile.test.ts`
Expected: FAIL — cannot find module `@/lib/forecast/percentile`.

- [ ] **Step 4: Implement**

`lib/forecast/percentile.ts`:
```ts
import type { Interval } from './types'

/** Linear-interpolation percentile (q in [0,1]) over a numeric sample. */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) {
    throw new Error('percentile: empty values')
  }
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const frac = pos - lo
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac
}

/** p25 / median / p75 interval over a numeric sample. */
export function interval(values: number[]): Interval {
  return {
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/lib/forecast/percentile.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/forecast/types.ts lib/forecast/percentile.ts __tests__/lib/forecast/percentile.test.ts
git commit -m "feat: forecast types + percentile util [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Metric extraction

**Files:**
- Create: `lib/forecast/metrics.ts`
- Test: `__tests__/lib/forecast/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/lib/forecast/metrics.test.ts`:
```ts
import { extractMetrics } from '@/lib/forecast/metrics'
import type { ForecastCandidate } from '@/lib/forecast/types'

function candidate(over: Partial<ForecastCandidate>): ForecastCandidate {
  return {
    id: 't1',
    title: 'x',
    identifier: 'LUM-1',
    tags: [],
    agentRuns: [],
    mergedPrAt: [],
    ...over,
  }
}

const h = (n: number) => new Date(2026, 0, 1, n, 0, 0) // n-th hour of the day

describe('extractMetrics', () => {
  it('counts agent runs as iterations', () => {
    const m = extractMetrics(
      candidate({
        agentRuns: [
          { startedAt: h(0), finishedAt: h(1) },
          { startedAt: h(2), finishedAt: h(3) },
        ],
      })
    )
    expect(m.iterations).toBe(2)
  })

  it('counts merged PRs', () => {
    const m = extractMetrics(
      candidate({ mergedPrAt: [h(5), h(6)], agentRuns: [{ startedAt: h(0), finishedAt: h(1) }] })
    )
    expect(m.mergedPrs).toBe(2)
  })

  it('anchors cycle from first run start to latest merged PR', () => {
    const m = extractMetrics(
      candidate({
        agentRuns: [
          { startedAt: h(1), finishedAt: h(2) },
          { startedAt: h(3), finishedAt: h(4) },
        ],
        mergedPrAt: [h(5)],
      })
    )
    // first start = 1h, latest merge = 5h → 4h
    expect(m.cycleHours).toBeCloseTo(4)
  })

  it('falls back to latest finishedAt when there is no merged PR', () => {
    const m = extractMetrics(
      candidate({
        agentRuns: [
          { startedAt: h(1), finishedAt: h(2) },
          { startedAt: h(3), finishedAt: h(7) },
        ],
      })
    )
    expect(m.mergedPrs).toBe(0)
    expect(m.cycleHours).toBeCloseTo(6) // 1h → 7h
  })

  it('returns null cycle when no merged PR and no finishedAt', () => {
    const m = extractMetrics(
      candidate({ agentRuns: [{ startedAt: h(1), finishedAt: null }] })
    )
    expect(m.cycleHours).toBeNull()
  })

  it('returns null cycle when there are no agent runs', () => {
    const m = extractMetrics(candidate({ agentRuns: [], mergedPrAt: [h(5)] }))
    expect(m.cycleHours).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/lib/forecast/metrics.test.ts`
Expected: FAIL — cannot find module `@/lib/forecast/metrics`.

- [ ] **Step 3: Implement**

`lib/forecast/metrics.ts`:
```ts
import type { ForecastCandidate, CandidateMetrics } from './types'

const MS_PER_HOUR = 1000 * 60 * 60

/**
 * Iterations = number of agent runs.
 * Merged PRs = number of merged-PR timestamps.
 * Cycle (hours) = first agent-run start → completion, where completion is the
 * latest merged-PR time, or (if none) the latest agent-run finishedAt.
 * Returns cycleHours = null when start or completion is unknown.
 */
export function extractMetrics(c: ForecastCandidate): CandidateMetrics {
  const iterations = c.agentRuns.length
  const mergedAts = c.mergedPrAt.filter((d): d is Date => d !== null)
  const mergedPrs = mergedAts.length

  const startTimes = c.agentRuns.map(r => r.startedAt.getTime())
  const start = startTimes.length ? Math.min(...startTimes) : null

  const finishTimes: number[] =
    mergedAts.length > 0
      ? mergedAts.map(d => d.getTime())
      : c.agentRuns
          .map(r => r.finishedAt)
          .filter((d): d is Date => d !== null)
          .map(d => d.getTime())
  const finish = finishTimes.length ? Math.max(...finishTimes) : null

  let cycleHours: number | null = null
  if (start !== null && finish !== null && finish >= start) {
    cycleHours = (finish - start) / MS_PER_HOUR
  }

  return { iterations, mergedPrs, cycleHours }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/lib/forecast/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/metrics.ts __tests__/lib/forecast/metrics.test.ts
git commit -m "feat: forecast metric extraction [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Candidate scoring

**Files:**
- Create: `lib/forecast/score.ts`
- Test: `__tests__/lib/forecast/score.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/lib/forecast/score.test.ts`:
```ts
import { tagJaccard, scoreCandidate } from '@/lib/forecast/score'

describe('tagJaccard', () => {
  it('is 0 when either set is empty', () => {
    expect(tagJaccard([], ['a'])).toBe(0)
    expect(tagJaccard(['a'], [])).toBe(0)
  })

  it('computes intersection over union, case-insensitive', () => {
    // {a,b} vs {B,c}: inter {b} = 1, union {a,b,c} = 3
    expect(tagJaccard(['a', 'b'], ['B', 'c'])).toBeCloseTo(1 / 3)
  })

  it('is 1 for identical sets', () => {
    expect(tagJaccard(['a', 'b'], ['a', 'b'])).toBe(1)
  })
})

describe('scoreCandidate', () => {
  it('blends 0.7 title + 0.3 tag, identical → 1', () => {
    const s = scoreCandidate(
      { title: 'Add OAuth login', tags: ['auth'] },
      { title: 'Add OAuth login', tags: ['auth'] }
    )
    expect(s).toBeCloseTo(1)
  })

  it('degrades gracefully when tags are absent (title-only)', () => {
    const s = scoreCandidate(
      { title: 'Add OAuth login', tags: [] },
      { title: 'Add OAuth login', tags: [] }
    )
    // 0.7 * 1 (title containment) + 0.3 * 0 (empty tags) = 0.7
    expect(s).toBeCloseTo(0.7)
  })

  it('rewards tag overlap on top of weak title match', () => {
    const withTags = scoreCandidate(
      { title: 'alpha', tags: ['x'] },
      { title: 'zzzzzz', tags: ['x'] }
    )
    const withoutTags = scoreCandidate(
      { title: 'alpha', tags: ['x'] },
      { title: 'zzzzzz', tags: ['y'] }
    )
    expect(withTags).toBeGreaterThan(withoutTags)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/lib/forecast/score.test.ts`
Expected: FAIL — cannot find module `@/lib/forecast/score`.

- [ ] **Step 3: Implement**

`lib/forecast/score.ts`:
```ts
import { bigramSimilarity } from '@/lib/similarity'

/** Jaccard similarity over two tag-name sets (0 when either is empty). */
export function tagJaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a.map(t => t.toLowerCase()))
  const setB = new Set(b.map(t => t.toLowerCase()))
  let inter = 0
  for (const t of setA) {
    if (setB.has(t)) inter++
  }
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}

/** Combined similarity: 0.7 * title bigram + 0.3 * tag Jaccard. */
export function scoreCandidate(
  target: { title: string; tags: string[] },
  candidate: { title: string; tags: string[] }
): number {
  const titleScore = bigramSimilarity(target.title, candidate.title)
  const tagScore = tagJaccard(target.tags, candidate.tags)
  return 0.7 * titleScore + 0.3 * tagScore
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/lib/forecast/score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/score.ts __tests__/lib/forecast/score.test.ts
git commit -m "feat: forecast candidate scoring [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Repository

**Files:**
- Create: `lib/repositories/forecast.repository.ts`
- Test: `__tests__/repositories/forecast.repository.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/repositories/forecast.repository.test.ts`:
```ts
/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { forecastRepository } from '@/lib/repositories/forecast.repository'

const findUnique = prisma.task.findUnique as jest.Mock
const findMany = prisma.task.findMany as jest.Mock

beforeEach(() => {
  findUnique.mockReset()
  findMany.mockReset()
})

describe('loadForecastInputs', () => {
  it('returns null when the target task is missing', async () => {
    findUnique.mockResolvedValue(null)
    expect(await forecastRepository.loadForecastInputs('nope')).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('maps target + candidates into the domain shape', async () => {
    findUnique.mockResolvedValue({
      id: 't1',
      title: 'Target',
      projectId: 'p1',
      taskTags: [{ tag: { name: 'auth' } }],
    })
    findMany.mockResolvedValue([
      {
        id: 't2',
        title: 'Older',
        number: 42,
        team: { identifier: 'LUM' },
        taskTags: [{ tag: { name: 'auth' } }, { tag: { name: 'api' } }],
        agentRuns: [{ startedAt: new Date(0), finishedAt: new Date(1) }],
        pullRequests: [{ mergedAt: new Date(2) }],
      },
    ])

    const result = await forecastRepository.loadForecastInputs('t1')
    expect(result).not.toBeNull()
    expect(result!.target).toEqual({
      id: 't1',
      title: 'Target',
      projectId: 'p1',
      tags: ['auth'],
    })
    expect(result!.candidates).toHaveLength(1)
    expect(result!.candidates[0]).toMatchObject({
      id: 't2',
      identifier: 'LUM-42',
      tags: ['auth', 'api'],
      mergedPrAt: [new Date(2)],
    })

    // scopes to same project, DONE, excludes self, requires an agent run
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'p1',
          status: 'DONE',
          id: { not: 't1' },
          agentRuns: { some: {} },
        }),
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/repositories/forecast.repository.test.ts`
Expected: FAIL — cannot find module `@/lib/repositories/forecast.repository`.

- [ ] **Step 3: Implement**

`lib/repositories/forecast.repository.ts`:
```ts
import { prisma } from '@/lib/db/prisma'
import type { ForecastInputs, ForecastCandidate } from '@/lib/forecast/types'

export const forecastRepository = {
  /**
   * Load the target task plus all DONE candidate tasks in the same project
   * that have at least one agent run (real execution data). Returns null if
   * the target task does not exist.
   */
  async loadForecastInputs(taskId: string): Promise<ForecastInputs | null> {
    const target = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        projectId: true,
        taskTags: { select: { tag: { select: { name: true } } } },
      },
    })
    if (!target) return null

    const rows = await prisma.task.findMany({
      where: {
        projectId: target.projectId,
        status: 'DONE',
        id: { not: taskId },
        agentRuns: { some: {} },
      },
      select: {
        id: true,
        title: true,
        number: true,
        team: { select: { identifier: true } },
        taskTags: { select: { tag: { select: { name: true } } } },
        agentRuns: { select: { startedAt: true, finishedAt: true } },
        pullRequests: {
          where: { state: 'merged' },
          select: { mergedAt: true },
        },
      },
    })

    const candidates: ForecastCandidate[] = rows.map(r => ({
      id: r.id,
      title: r.title,
      identifier: `${r.team.identifier}-${r.number}`,
      tags: r.taskTags.map(tt => tt.tag.name),
      agentRuns: r.agentRuns.map(a => ({
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
      })),
      mergedPrAt: r.pullRequests.map(p => p.mergedAt),
    }))

    return {
      target: {
        id: target.id,
        title: target.title,
        projectId: target.projectId,
        tags: target.taskTags.map(tt => tt.tag.name),
      },
      candidates,
    }
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/repositories/forecast.repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/forecast.repository.ts __tests__/repositories/forecast.repository.test.ts
git commit -m "feat: forecast repository query [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Service

**Files:**
- Create: `lib/services/forecast.service.ts`
- Modify: `lib/services/index.ts`
- Test: `__tests__/services/forecast.service.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/services/forecast.service.test.ts`:
```ts
/** @jest-environment node */
jest.mock('@/lib/repositories/forecast.repository', () => ({
  forecastRepository: { loadForecastInputs: jest.fn() },
}))

import { forecastRepository } from '@/lib/repositories/forecast.repository'
import { forecastService } from '@/lib/services/forecast.service'
import type { ForecastCandidate } from '@/lib/forecast/types'

const load = forecastRepository.loadForecastInputs as jest.Mock

beforeEach(() => load.mockReset())

const h = (n: number) => new Date(2026, 0, 1, n, 0, 0)

// A completed candidate whose title equals the target title (bigram → 1),
// with `runs` agent runs (each 1h), `prs` merged PRs, finishing at hour `end`.
function cand(
  id: string,
  runs: number,
  prs: number,
  end: number
): ForecastCandidate {
  return {
    id,
    title: 'Add OAuth login',
    identifier: `LUM-${id}`,
    tags: ['auth'],
    agentRuns: Array.from({ length: runs }, (_, i) => ({
      startedAt: h(i),
      finishedAt: h(i + 1),
    })),
    mergedPrAt: Array.from({ length: prs }, () => h(end)),
  }
}

const target = { id: 'tgt', title: 'Add OAuth login', tags: ['auth'], projectId: 'p1' }

it('returns insufficientData when the task is missing', async () => {
  load.mockResolvedValue(null)
  const f = await forecastService.getTaskForecast('missing')
  expect(f.insufficientData).toBe(true)
  expect(f.cohortSize).toBe(0)
})

it('returns insufficientData (with ≤2 sources) when cohort < 3', async () => {
  load.mockResolvedValue({
    target,
    candidates: [cand('1', 2, 1, 5), cand('2', 3, 1, 6)],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.insufficientData).toBe(true)
  expect(f.cohortSize).toBe(2)
  expect(f.iterations).toBeNull()
  expect(f.sources.length).toBeLessThanOrEqual(2)
})

it('computes intervals when cohort ≥ 3', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      cand('1', 1, 1, 1),
      cand('2', 2, 1, 2),
      cand('3', 3, 2, 3),
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.insufficientData).toBe(false)
  expect(f.cohortSize).toBe(3)
  expect(f.iterations).toEqual({ p25: 1.5, median: 2, p75: 2.5 })
  expect(f.mergedPrs).toEqual({ p25: 1, median: 1, p75: 1.5 })
  expect(f.cycleHours).not.toBeNull()
  // sources sorted by score desc; all titles identical → stable, 3 entries
  expect(f.sources).toHaveLength(3)
})

it('excludes candidates below the score threshold', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      cand('1', 1, 1, 1),
      cand('2', 2, 1, 2),
      { ...cand('3', 3, 2, 3), title: 'zzzzzzz', tags: [] }, // score ≈ 0
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  // only 2 pass the threshold → insufficient
  expect(f.cohortSize).toBe(2)
  expect(f.insufficientData).toBe(true)
})

it('returns null cycleHours when fewer than 3 candidates have a cycle', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      { ...cand('1', 1, 0, 0), agentRuns: [{ startedAt: h(0), finishedAt: null }] },
      { ...cand('2', 1, 0, 0), agentRuns: [{ startedAt: h(0), finishedAt: null }] },
      cand('3', 2, 1, 3),
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.insufficientData).toBe(false) // 3 in cohort
  expect(f.iterations).not.toBeNull()
  expect(f.cycleHours).toBeNull() // only 1 has a computable cycle
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/services/forecast.service.test.ts`
Expected: FAIL — cannot find module `@/lib/services/forecast.service`.

- [ ] **Step 3: Implement**

`lib/services/forecast.service.ts`:
```ts
import { forecastRepository } from '@/lib/repositories/forecast.repository'
import { scoreCandidate } from '@/lib/forecast/score'
import { extractMetrics } from '@/lib/forecast/metrics'
import { interval } from '@/lib/forecast/percentile'
import type { TaskForecast, ForecastSource } from '@/lib/forecast/types'

const SCORE_THRESHOLD = 0.3
const MAX_COHORT = 20
const MIN_COHORT = 3

const EMPTY: TaskForecast = {
  insufficientData: true,
  cohortSize: 0,
  iterations: null,
  mergedPrs: null,
  cycleHours: null,
  sources: [],
}

export const forecastService = {
  /**
   * Retrieve a delivery forecast for a task from similar completed tasks'
   * real execution data. Deterministic — no LLM, no hidden points.
   */
  async getTaskForecast(taskId: string): Promise<TaskForecast> {
    const inputs = await forecastRepository.loadForecastInputs(taskId)
    if (!inputs) return EMPTY

    const cohort = inputs.candidates
      .map(c => ({ candidate: c, score: scoreCandidate(inputs.target, c) }))
      .filter(s => s.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_COHORT)

    const sources: ForecastSource[] = cohort.map(({ candidate, score }) => {
      const m = extractMetrics(candidate)
      return {
        taskId: candidate.id,
        identifier: candidate.identifier,
        title: candidate.title,
        iterations: m.iterations,
        mergedPrs: m.mergedPrs,
        cycleHours: m.cycleHours,
        score,
      }
    })

    if (sources.length < MIN_COHORT) {
      return {
        insufficientData: true,
        cohortSize: sources.length,
        iterations: null,
        mergedPrs: null,
        cycleHours: null,
        sources: sources.slice(0, 2),
      }
    }

    const cycleValues = sources
      .map(s => s.cycleHours)
      .filter((v): v is number => v !== null)

    return {
      insufficientData: false,
      cohortSize: sources.length,
      iterations: interval(sources.map(s => s.iterations)),
      mergedPrs: interval(sources.map(s => s.mergedPrs)),
      cycleHours:
        cycleValues.length >= MIN_COHORT ? interval(cycleValues) : null,
      sources,
    }
  },
}
```

- [ ] **Step 4: Export from the services barrel**

In `lib/services/index.ts`, add after the `sprintSummaryService` export line:
```ts
export { forecastService } from './forecast.service'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/services/forecast.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/forecast.service.ts lib/services/index.ts __tests__/services/forecast.service.test.ts
git commit -m "feat: forecast service [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: API route + client + constants + query key

**Files:**
- Create: `app/api/tasks/[id]/forecast/route.ts`
- Modify: `lib/api-client/tasks.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `lib/query/keys.ts`

> No unit test for the thin route — it is covered by the service test plus the
> final `tsc` pass. (Matches the codebase: most `app/api/**` routes have no
> isolated handler test.)

- [ ] **Step 1: Add the route constant**

In `app/workspace/[workspaceUrl]/constants.ts`, inside the `tasks: { ... }` object, after the `agentRuns` line:
```ts
    forecast: (taskId: string) => `/api/tasks/${taskId}/forecast`,
```

- [ ] **Step 2: Add the API client method**

In `lib/api-client/tasks.ts`, inside `tasksClient`, after the `getAgentRuns` method:
```ts
  forecast<T>(taskId: string) {
    return apiFetch<T>(API.tasks.forecast(taskId))
  },
```

- [ ] **Step 3: Add the query key**

In `lib/query/keys.ts`, inside `tasks: { ... }`, after the `detail` line:
```ts
    forecast: (id: string) => ['tasks', 'forecast', id] as const,
```

- [ ] **Step 4: Create the route**

`app/api/tasks/[id]/forecast/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskService, forecastService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/forecast — delivery forecast retrieved from similar
 * completed tasks' execution history.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const taskDetail = await taskService.getTaskDetail(id)
    if (!taskDetail) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskDetail.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const forecast = await forecastService.getTaskForecast(id)
    return NextResponse.json({ forecast })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/tasks/[id]/forecast/route.ts lib/api-client/tasks.ts app/workspace/[workspaceUrl]/constants.ts lib/query/keys.ts
git commit -m "feat: forecast API route + client + query key [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: useTaskForecast hook

**Files:**
- Create: `app/workspace/[workspaceUrl]/hooks/useTaskForecast.ts`

> Hook is exercised end-to-end via the component in the preview; no isolated
> hook test (matches `useSprints.ts`, which has none).

- [ ] **Step 1: Implement**

`app/workspace/[workspaceUrl]/hooks/useTaskForecast.ts`:
```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskForecast } from '@/lib/forecast/types'

/** Lazily fetch a task's delivery forecast. Disabled until taskId is known. */
export function useTaskForecast(taskId: string | null) {
  const enabled = !!taskId
  const query = useQuery<{ forecast: TaskForecast }>({
    queryKey: queryKeys.tasks.forecast(taskId ?? ''),
    queryFn: () =>
      tasksClient.forecast<{ forecast: TaskForecast }>(taskId as string),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return {
    forecast: query.data?.forecast,
    isLoading: query.isPending && enabled,
    error: query.error ?? undefined,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/[workspaceUrl]/hooks/useTaskForecast.ts
git commit -m "feat: useTaskForecast hook [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: i18n keys (all 16 locales)

**Files:**
- Modify: all of `lib/i18n/{en,en-GB,en-AU,zh-CN,zh-TW,ja,ko,es,es-419,fr,de,ru,hi,id,ms,vi}.json`

> Do this BEFORE the component so the component's `formatMessage` ids resolve.
> Per CLAUDE.md: every locale gets a real translation — never an English
> fallback. The number-only `forecast.range` is identical across all locales
> (digits + punctuation); the text keys are translated per the table.

- [ ] **Step 1: Add the English keys (`en.json`, `en-GB.json`, `en-AU.json` — identical)**

Insert these keys (keep the file valid JSON; alphabetical placement near other `f*` keys is preferred but not required):
```json
  "forecast.title": "Delivery forecast",
  "forecast.basis": "Based on {count, plural, one {# similar task} other {# similar tasks}}",
  "forecast.metricIterations": "Iterations",
  "forecast.metricPrs": "Merged PRs",
  "forecast.metricCycle": "Cycle",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median}d ({low}–{high}d)",
  "forecast.cycleHours": "{median}h ({low}–{high}h)",
  "forecast.insufficient": "Not enough history for a reliable forecast",
  "forecast.viewSources": "View source tasks",
```

- [ ] **Step 2: Add the translated keys to the remaining locales**

`forecast.range` is `"{median} ({low}–{high})"` in **every** file. The rest:

**zh-CN.json**
```json
  "forecast.title": "交付预测",
  "forecast.basis": "基于 {count} 个相似已完成任务",
  "forecast.metricIterations": "迭代轮次",
  "forecast.metricPrs": "合并 PR 数",
  "forecast.metricCycle": "周期",
  "forecast.range": "{median}(常见 {low}–{high})",
  "forecast.cycleDays": "{median} 天(常见 {low}–{high} 天)",
  "forecast.cycleHours": "{median} 小时(常见 {low}–{high} 小时)",
  "forecast.insufficient": "历史数据不足,暂无可靠预测",
  "forecast.viewSources": "查看依据的历史任务",
```

**zh-TW.json**
```json
  "forecast.title": "交付預測",
  "forecast.basis": "基於 {count} 個相似已完成任務",
  "forecast.metricIterations": "迭代輪次",
  "forecast.metricPrs": "合併 PR 數",
  "forecast.metricCycle": "週期",
  "forecast.range": "{median}(常見 {low}–{high})",
  "forecast.cycleDays": "{median} 天(常見 {low}–{high} 天)",
  "forecast.cycleHours": "{median} 小時(常見 {low}–{high} 小時)",
  "forecast.insufficient": "歷史資料不足,暫無可靠預測",
  "forecast.viewSources": "查看依據的歷史任務",
```

**ja.json**
```json
  "forecast.title": "デリバリー予測",
  "forecast.basis": "類似の完了タスク {count} 件に基づく",
  "forecast.metricIterations": "反復回数",
  "forecast.metricPrs": "マージ済み PR 数",
  "forecast.metricCycle": "サイクル",
  "forecast.range": "{median}(目安 {low}–{high})",
  "forecast.cycleDays": "{median}日(目安 {low}–{high}日)",
  "forecast.cycleHours": "{median}時間(目安 {low}–{high}時間)",
  "forecast.insufficient": "信頼できる予測には履歴が不足しています",
  "forecast.viewSources": "参照した履歴タスクを表示",
```

**ko.json**
```json
  "forecast.title": "딜리버리 예측",
  "forecast.basis": "유사한 완료 작업 {count}개 기준",
  "forecast.metricIterations": "반복 횟수",
  "forecast.metricPrs": "병합된 PR 수",
  "forecast.metricCycle": "주기",
  "forecast.range": "{median} (보통 {low}–{high})",
  "forecast.cycleDays": "{median}일 (보통 {low}–{high}일)",
  "forecast.cycleHours": "{median}시간 (보통 {low}–{high}시간)",
  "forecast.insufficient": "신뢰할 만한 예측을 위한 이력이 부족합니다",
  "forecast.viewSources": "참고한 이력 작업 보기",
```

**es.json**
```json
  "forecast.title": "Previsión de entrega",
  "forecast.basis": "Basado en {count, plural, one {# tarea similar} other {# tareas similares}}",
  "forecast.metricIterations": "Iteraciones",
  "forecast.metricPrs": "PR fusionados",
  "forecast.metricCycle": "Ciclo",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} d ({low}–{high} d)",
  "forecast.cycleHours": "{median} h ({low}–{high} h)",
  "forecast.insufficient": "No hay suficiente historial para una previsión fiable",
  "forecast.viewSources": "Ver tareas de referencia",
```

**es-419.json**
```json
  "forecast.title": "Previsión de entrega",
  "forecast.basis": "Basado en {count, plural, one {# tarea similar} other {# tareas similares}}",
  "forecast.metricIterations": "Iteraciones",
  "forecast.metricPrs": "PR fusionados",
  "forecast.metricCycle": "Ciclo",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} d ({low}–{high} d)",
  "forecast.cycleHours": "{median} h ({low}–{high} h)",
  "forecast.insufficient": "No hay suficiente historial para una previsión confiable",
  "forecast.viewSources": "Ver tareas de referencia",
```

**fr.json**
```json
  "forecast.title": "Prévision de livraison",
  "forecast.basis": "Basé sur {count, plural, one {# tâche similaire} other {# tâches similaires}}",
  "forecast.metricIterations": "Itérations",
  "forecast.metricPrs": "PR fusionnées",
  "forecast.metricCycle": "Cycle",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} j ({low}–{high} j)",
  "forecast.cycleHours": "{median} h ({low}–{high} h)",
  "forecast.insufficient": "Historique insuffisant pour une prévision fiable",
  "forecast.viewSources": "Voir les tâches de référence",
```

**de.json**
```json
  "forecast.title": "Lieferprognose",
  "forecast.basis": "Basierend auf {count, plural, one {# ähnlichen Aufgabe} other {# ähnlichen Aufgaben}}",
  "forecast.metricIterations": "Iterationen",
  "forecast.metricPrs": "Gemergte PRs",
  "forecast.metricCycle": "Zyklus",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} T ({low}–{high} T)",
  "forecast.cycleHours": "{median} Std. ({low}–{high} Std.)",
  "forecast.insufficient": "Nicht genügend Verlauf für eine zuverlässige Prognose",
  "forecast.viewSources": "Referenzaufgaben anzeigen",
```

**ru.json**
```json
  "forecast.title": "Прогноз поставки",
  "forecast.basis": "На основе {count, plural, one {# похожей задачи} few {# похожих задач} many {# похожих задач} other {# похожих задач}}",
  "forecast.metricIterations": "Итерации",
  "forecast.metricPrs": "Влитые PR",
  "forecast.metricCycle": "Цикл",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} дн. ({low}–{high} дн.)",
  "forecast.cycleHours": "{median} ч ({low}–{high} ч)",
  "forecast.insufficient": "Недостаточно истории для надёжного прогноза",
  "forecast.viewSources": "Показать исходные задачи",
```

**hi.json**
```json
  "forecast.title": "डिलीवरी पूर्वानुमान",
  "forecast.basis": "{count} समान पूर्ण कार्यों के आधार पर",
  "forecast.metricIterations": "पुनरावृत्तियाँ",
  "forecast.metricPrs": "मर्ज किए गए PR",
  "forecast.metricCycle": "चक्र",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} दिन ({low}–{high} दिन)",
  "forecast.cycleHours": "{median} घंटे ({low}–{high} घंटे)",
  "forecast.insufficient": "विश्वसनीय पूर्वानुमान के लिए पर्याप्त इतिहास नहीं है",
  "forecast.viewSources": "स्रोत कार्य देखें",
```

**id.json**
```json
  "forecast.title": "Prakiraan pengiriman",
  "forecast.basis": "Berdasarkan {count} tugas serupa yang selesai",
  "forecast.metricIterations": "Iterasi",
  "forecast.metricPrs": "PR yang digabung",
  "forecast.metricCycle": "Siklus",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} hari ({low}–{high} hari)",
  "forecast.cycleHours": "{median} jam ({low}–{high} jam)",
  "forecast.insufficient": "Riwayat tidak cukup untuk prakiraan yang andal",
  "forecast.viewSources": "Lihat tugas rujukan",
```

**ms.json**
```json
  "forecast.title": "Ramalan penghantaran",
  "forecast.basis": "Berdasarkan {count} tugasan serupa yang selesai",
  "forecast.metricIterations": "Lelaran",
  "forecast.metricPrs": "PR digabung",
  "forecast.metricCycle": "Kitaran",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} hari ({low}–{high} hari)",
  "forecast.cycleHours": "{median} jam ({low}–{high} jam)",
  "forecast.insufficient": "Sejarah tidak mencukupi untuk ramalan yang boleh dipercayai",
  "forecast.viewSources": "Lihat tugasan rujukan",
```

**vi.json**
```json
  "forecast.title": "Dự báo bàn giao",
  "forecast.basis": "Dựa trên {count} công việc tương tự đã hoàn thành",
  "forecast.metricIterations": "Số vòng lặp",
  "forecast.metricPrs": "PR đã hợp nhất",
  "forecast.metricCycle": "Chu kỳ",
  "forecast.range": "{median} ({low}–{high})",
  "forecast.cycleDays": "{median} ngày ({low}–{high} ngày)",
  "forecast.cycleHours": "{median} giờ ({low}–{high} giờ)",
  "forecast.insufficient": "Không đủ lịch sử để dự báo đáng tin cậy",
  "forecast.viewSources": "Xem công việc tham chiếu",
```

- [ ] **Step 3: Validate every locale is still valid JSON**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "INVALID: $f"; done; echo "done"
```
Expected: prints `done` with no `INVALID:` lines.

- [ ] **Step 4: Verify the key count matches across locales**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && for f in lib/i18n/*.json; do printf "%s " "$f"; node -e "const o=require('./$f');console.log(Object.keys(o).filter(k=>k.startsWith('forecast.')).length)"; done
```
Expected: every file prints `10`.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n/*.json
git commit -m "i18n: forecast panel strings (all locales) [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: ForecastPanel component + wire into sidebar

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/ForecastPanel.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`

- [ ] **Step 1: Create the component**

`app/workspace/[workspaceUrl]/components/ForecastPanel.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useTaskForecast } from '../hooks/useTaskForecast'
import type { Interval } from '@/lib/forecast/types'

function ForecastRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-baseline justify-between py-1'>
      <span className='text-xs text-zinc-500 dark:text-zinc-400'>{label}</span>
      <span className='text-sm text-zinc-700 dark:text-zinc-300 tabular-nums'>
        {value}
      </span>
    </div>
  )
}

export function ForecastPanel({ taskId }: { taskId: string }) {
  const intl = useIntl()
  const [showSources, setShowSources] = useState(false)
  const { forecast, isLoading, error } = useTaskForecast(taskId)

  // Hide entirely while loading or on error — keeps the sidebar quiet.
  if (isLoading || error || !forecast) return null

  const title = intl.formatMessage({ id: 'forecast.title' })
  const heading = (
    <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2'>
      {title}
    </p>
  )

  if (forecast.insufficientData) {
    return (
      <section className='mt-6 pt-6 border-t border-zinc-100 dark:border-zinc-800'>
        {heading}
        <p className='text-sm text-zinc-500 dark:text-zinc-400'>
          {intl.formatMessage({ id: 'forecast.insufficient' })}
        </p>
      </section>
    )
  }

  const round = (n: number) => Math.round(n)
  const numRange = (iv: Interval) =>
    intl.formatMessage(
      { id: 'forecast.range' },
      { median: round(iv.median), low: round(iv.p25), high: round(iv.p75) }
    )
  const cycleText = (iv: Interval) => {
    const useHours = iv.median < 24
    const div = useHours ? 1 : 24
    return intl.formatMessage(
      { id: useHours ? 'forecast.cycleHours' : 'forecast.cycleDays' },
      {
        median: round(iv.median / div),
        low: round(iv.p25 / div),
        high: round(iv.p75 / div),
      }
    )
  }

  return (
    <section className='mt-6 pt-6 border-t border-zinc-100 dark:border-zinc-800'>
      <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1'>
        {title}
      </p>
      <p className='text-xs text-zinc-400 dark:text-zinc-500 mb-2'>
        {intl.formatMessage(
          { id: 'forecast.basis' },
          { count: forecast.cohortSize }
        )}
      </p>

      {forecast.iterations && (
        <ForecastRow
          label={intl.formatMessage({ id: 'forecast.metricIterations' })}
          value={numRange(forecast.iterations)}
        />
      )}
      {forecast.mergedPrs && (
        <ForecastRow
          label={intl.formatMessage({ id: 'forecast.metricPrs' })}
          value={numRange(forecast.mergedPrs)}
        />
      )}
      {forecast.cycleHours && (
        <ForecastRow
          label={intl.formatMessage({ id: 'forecast.metricCycle' })}
          value={cycleText(forecast.cycleHours)}
        />
      )}

      {forecast.sources.length > 0 && (
        <>
          <button
            type='button'
            onClick={() => setShowSources(v => !v)}
            className='mt-2 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors'
          >
            {intl.formatMessage({ id: 'forecast.viewSources' })}
          </button>
          {showSources && (
            <ul className='mt-2 space-y-1'>
              {forecast.sources.map(s => (
                <li
                  key={s.taskId}
                  className='text-xs text-zinc-500 dark:text-zinc-400'
                >
                  {s.identifier} · {s.title}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Render it at the end of the sidebar**

In `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`:

Add the import near the top (with the other component imports):
```tsx
import { ForecastPanel } from './ForecastPanel'
```

Then, as the **last child inside the sidebar's root `<div>`** (the `w-72 shrink-0 border-l … overflow-y-auto px-5 py-6 …` container — just before its closing `</div>`), add:
```tsx
      <ForecastPanel taskId={task.id} />
```

- [ ] **Step 3: Type-check the touched frontend files**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx tsc --noEmit`
Expected: no errors. (If it reports a stale Prisma client error like "X is not exported", run `npx prisma generate` first — see Task 10.)

- [ ] **Step 4: Token lint (no raw colors introduced)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npm run lint:tokens`
Expected: passes (the panel uses only `zinc-*` token classes — no hex/raw colors).

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/ForecastPanel.tsx app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx
git commit -m "feat: delivery forecast panel on task detail [LUM-171]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Regenerate the Prisma client (clears stale-client tsc errors)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx prisma generate`
Expected: "Generated Prisma Client".

- [ ] **Step 2: Full type check**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full forecast test suite**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && npx jest __tests__/lib/forecast __tests__/repositories/forecast.repository.test.ts __tests__/services/forecast.service.test.ts`
Expected: all suites PASS.

- [ ] **Step 4: Confirm no `console.log` and named exports only**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-171 && grep -rn "console.log\|export default" lib/forecast lib/services/forecast.service.ts lib/repositories/forecast.repository.ts app/workspace/\[workspaceUrl\]/components/ForecastPanel.tsx app/workspace/\[workspaceUrl\]/hooks/useTaskForecast.ts || echo "clean"`
Expected: prints `clean`.

- [ ] **Step 5: Manual preview check (best-effort)**

Open a task that belongs to a project with ≥3 completed tasks that have agent runs; confirm the "Delivery forecast" panel shows three interval rows and the "View source tasks" toggle lists the contributing tasks. Open a task in a fresh project; confirm it shows "Not enough history…". (Per project memory, the preview browser may not reach the local dev server — if so, rely on the jsdom-free component logic + tsc + jest as the proof and note preview was unavailable.)

---

## Self-Review (completed during planning)

- **Spec coverage:** §3 metrics → Task 2; §4 cohort/scoring/threshold/interval → Tasks 3 & 5 (incl. per-metric cycle-sample handling); §5 layering → Tasks 4–7; §6 UI (normal / insufficient / loading) → Task 9; §7 tests → Tasks 1–5 + Task 10. i18n rule (all locales) → Task 8.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `Interval`, `ForecastCandidate`, `ForecastInputs`, `CandidateMetrics`, `ForecastSource`, `TaskForecast` defined in Task 1 and used unchanged in Tasks 2–9. `forecastRepository.loadForecastInputs`, `forecastService.getTaskForecast`, `tasksClient.forecast`, `queryKeys.tasks.forecast`, `useTaskForecast`, `ForecastPanel` names consistent across tasks.
- **Edge case locked:** cohort `<3` → insufficient; cycle sample `<3` → `cycleHours: null` while other intervals still compute (Task 5 test covers it).
