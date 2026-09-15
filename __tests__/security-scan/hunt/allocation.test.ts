/** @jest-environment node */
import {
  allocateTaskBudgets,
  isOversized,
  plannedTaskCap,
  siteCategory,
  taskSiteCount,
  taskTimeMs,
} from '@/lib/security-scan/hunt/allocation'
import {
  HUNT_MAX_PLANNED_TASKS,
  HUNT_MAX_PLANNED_TASKS_CEILING,
  HUNT_OVERSIZED_SOURCE_FILES,
  HUNT_TASK_CAP_TIERS,
  HUNT_TASK_TOKEN_MAX,
  HUNT_TASK_TOKEN_MEAN,
  HUNT_TASK_TOKEN_MIN,
  huntTimeBudgetMs,
  huntTokenBudget,
  HUNT_MAX_STEPS_PER_CATEGORY,
  HUNT_TASK_TIME_MS,
  HUNT_TRACE_MAX_STEPS,
} from '@/lib/services/security-hunt.config'
import type { HuntSignalSite } from '@/lib/security-scan/hunt/trigger'

const site = (rule: string, path: string, line: number): HuntSignalSite => ({
  rule,
  path,
  line,
})

// LUM-787 follow-up — the hunt is sized to the diff. A 600-line and a
// 4 800-line PR used to get the same three tasks, and a task briefed to
// check six call sites got the allowance of one briefed to check one.
describe('LUM-787 sizing the hunt to the diff', () => {
  it('plannedTaskCap follows the source-file tiers and never exceeds the ceiling', () => {
    expect(plannedTaskCap(0)).toBe(HUNT_MAX_PLANNED_TASKS)
    expect(plannedTaskCap(1)).toBe(3)
    expect(plannedTaskCap(12)).toBe(3)
    expect(plannedTaskCap(13)).toBe(4)
    expect(plannedTaskCap(30)).toBe(4)
    expect(plannedTaskCap(31)).toBe(5)
    expect(plannedTaskCap(500)).toBe(HUNT_MAX_PLANNED_TASKS_CEILING)
    expect(plannedTaskCap(Number.NaN)).toBe(HUNT_MAX_PLANNED_TASKS)
    // The tiers are ascending and the last one catches everything.
    for (let i = 1; i < HUNT_TASK_CAP_TIERS.length; i++) {
      expect(HUNT_TASK_CAP_TIERS[i]!.sourceFiles).toBeGreaterThan(
        HUNT_TASK_CAP_TIERS[i - 1]!.sourceFiles
      )
      expect(HUNT_TASK_CAP_TIERS[i]!.tasks).toBeGreaterThanOrEqual(
        HUNT_TASK_CAP_TIERS[i - 1]!.tasks
      )
    }
    expect(
      HUNT_TASK_CAP_TIERS[HUNT_TASK_CAP_TIERS.length - 1]!.sourceFiles
    ).toBe(Number.POSITIVE_INFINITY)
  })

  it('the scan budgets follow the cap: pass 1 is cap × mean, the total leaves a retry of every task', () => {
    for (const cap of [3, 4, 5]) {
      expect(huntTokenBudget(cap)).toBe(cap * HUNT_TASK_TOKEN_MEAN * 2)
      // The clock: pass-1 sum (≤ cap × 60 s) plus one retry of the longest
      // window a task can be allocated (the ceiling's 90 s).
      expect(huntTimeBudgetMs(cap)).toBe(
        cap * HUNT_TASK_TIME_MS + taskTimeMs(HUNT_TASK_TOKEN_MAX)
      )
    }
    // The smallest tier is the user's 50k × 3 = 150k pass 1, 300k total.
    expect(huntTokenBudget(HUNT_MAX_PLANNED_TASKS)).toBe(300_000)
    expect(huntTimeBudgetMs(HUNT_MAX_PLANNED_TASKS)).toBe(276_000)
  })

  it('taskTimeMs follows the allowance: 60 s at the mean and below, proportionally more above', () => {
    expect(taskTimeMs(HUNT_TASK_TOKEN_MIN)).toBe(HUNT_TASK_TIME_MS)
    expect(taskTimeMs(HUNT_TASK_TOKEN_MEAN)).toBe(HUNT_TASK_TIME_MS)
    expect(taskTimeMs(HUNT_TASK_TOKEN_MAX)).toBe(96_000)
    expect(taskTimeMs(0)).toBe(HUNT_TASK_TIME_MS)
  })

  it('the step cap can spend the ceiling and the audit can hold every step', () => {
    // 80k at ~3.2k per step is ~25 steps; a 12-step cap left 6–12k of a 45k
    // allowance unspent on the replay. And the trace keeps
    // HUNT_TRACE_MAX_STEPS rows — a cap above it would run steps the audit
    // cannot show.
    expect(HUNT_MAX_STEPS_PER_CATEGORY).toBeGreaterThanOrEqual(25)
    expect(HUNT_MAX_STEPS_PER_CATEGORY).toBeLessThanOrEqual(
      HUNT_TRACE_MAX_STEPS
    )
  })

  it('isOversized flags a diff past the source-file threshold', () => {
    expect(isOversized(HUNT_OVERSIZED_SOURCE_FILES)).toBe(false)
    expect(isOversized(HUNT_OVERSIZED_SOURCE_FILES + 1)).toBe(true)
  })

  it('siteCategory files sinks by the fallback map and entries under idor', () => {
    expect(siteCategory('sink:prisma-raw')).toBe('injection')
    expect(siteCategory('sink:child-process')).toBe('injection')
    expect(siteCategory('sink:fetch')).toBe('ssrf')
    expect(siteCategory('sink:llm-call')).toBe('prompt_injection')
    expect(siteCategory('entry:next-route-handler')).toBe('idor')
    expect(siteCategory('control:zod-parse')).toBeNull()
    expect(siteCategory('sink:unknown-thing')).toBeNull()
  })

  it('taskSiteCount counts distinct sites by starting point OR category', () => {
    const sites = [
      site('sink:prisma-raw', 'lib/a.ts', 10),
      site('sink:prisma-raw', 'lib/a.ts', 10), // duplicate
      site('sink:fetch', 'lib/b.ts', 5),
      site('control:auth', 'lib/c.ts', 7),
      site('entry:next-route-handler', 'app/api/x/route.ts', 3),
    ]
    // Injection task starting at lib/c.ts: lib/a.ts by category, lib/c.ts by
    // path; the fetch site and the entry are neither.
    expect(
      taskSiteCount(
        { category: 'injection', startingPoints: ['lib/c.ts'] },
        sites
      )
    ).toBe(2)
    // A floor-forced task has no starting points but still weighs its category.
    expect(taskSiteCount({ category: 'ssrf', startingPoints: [] }, sites)).toBe(
      1
    )
    expect(taskSiteCount({ category: 'idor', startingPoints: [] }, sites)).toBe(
      1
    )
    expect(taskSiteCount({ category: 'race', startingPoints: [] }, sites)).toBe(
      0
    )
  })

  it('allocateTaskBudgets: floor for everyone, the remainder by sites, each capped, the sum within pass 1', () => {
    const sites = [
      site('sink:llm-call', 'lib/services/a.ts', 1),
      site('sink:llm-call', 'lib/services/b.ts', 1),
      site('sink:llm-call', 'lib/services/c.ts', 1),
      site('sink:llm-call', 'lib/services/d.ts', 1),
      site('sink:llm-call', 'lib/services/e.ts', 1),
      site('sink:llm-call', 'lib/services/f.ts', 1),
      site('sink:child-process', 'lib/sandbox.ts', 40),
    ]
    const tasks = [
      { id: 't1', category: 'injection' as const, startingPoints: [] },
      { id: 't2', category: 'race' as const, startingPoints: [] },
      { id: 't3', category: 'prompt_injection' as const, startingPoints: [] },
    ]
    const out = allocateTaskBudgets(tasks, sites, 3)
    // Pass 1 = 150k; floor 3 × 30k = 90k; remainder 60k by weights 1 : 1 : 6.
    expect(out.get('t1')).toEqual({
      sites: 1,
      tokenBudget: 30_000 + 7_500,
      timeBudgetMs: HUNT_TASK_TIME_MS,
    })
    expect(out.get('t2')).toEqual({
      sites: 0,
      tokenBudget: 30_000 + 7_500,
      timeBudgetMs: HUNT_TASK_TIME_MS,
    })
    expect(out.get('t3')).toEqual({
      sites: 6,
      tokenBudget: 30_000 + 45_000,
      timeBudgetMs: 90_000,
    })
    const sum = [...out.values()].reduce((n, a) => n + a.tokenBudget, 0)
    expect(sum).toBeLessThanOrEqual(3 * HUNT_TASK_TOKEN_MEAN)
    for (const a of out.values()) {
      expect(a.tokenBudget).toBeGreaterThanOrEqual(HUNT_TASK_TOKEN_MIN)
      expect(a.tokenBudget).toBeLessThanOrEqual(HUNT_TASK_TOKEN_MAX)
    }
  })

  it('an even plan gets the mean each; a lone task gets the ceiling, not the whole pass', () => {
    const three = allocateTaskBudgets(
      [
        { id: 't1', category: 'injection' as const, startingPoints: [] },
        { id: 't2', category: 'ssrf' as const, startingPoints: [] },
        { id: 't3', category: 'idor' as const, startingPoints: [] },
      ],
      [],
      3
    )
    for (const a of three.values())
      expect(a.tokenBudget).toBe(HUNT_TASK_TOKEN_MEAN)
    const one = allocateTaskBudgets(
      [{ id: 't1', category: 'injection' as const, startingPoints: [] }],
      [],
      3
    )
    expect(one.get('t1')!.tokenBudget).toBe(HUNT_TASK_TOKEN_MAX)
    expect(allocateTaskBudgets([], [], 3).size).toBe(0)
  })

  it('a larger cap raises pass 1 with it, so five tasks still get the mean each', () => {
    const tasks = ['injection', 'ssrf', 'idor', 'race', 'logic'].map(
      (c, i) => ({
        id: `t${i + 1}`,
        category: c as 'injection',
        startingPoints: [],
      })
    )
    const out = allocateTaskBudgets(tasks, [], 5)
    for (const a of out.values())
      expect(a.tokenBudget).toBe(HUNT_TASK_TOKEN_MEAN)
    const sum = [...out.values()].reduce((n, a) => n + a.tokenBudget, 0)
    expect(sum).toBeLessThanOrEqual(huntTokenBudget(5) / 2)
  })
})
