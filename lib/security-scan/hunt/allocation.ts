/**
 * LUM-787 follow-up — sizing the hunt to the pull request.
 *
 * Three numbers used to be flat: every scan planned at most 3 tasks, every
 * task got the same token allowance, and every scan got the same total. A
 * 600-line PR and a 4 800-line PR (prod: PR 984 vs PR 1004) were hunted with
 * the same three tasks, and a task briefed to check six call sites got the
 * allowance of one briefed to check one. Both are functions of the diff,
 * and both are derived here, from the two facts stage A already computed:
 * how many source files the diff touched, and which signal sites it lit.
 *
 * - `plannedTaskCap(sourceFiles)` — how many tasks the planner may propose,
 *   tiered on touched source files, never above HUNT_MAX_PLANNED_TASKS_CEILING.
 * - `allocateTaskBudgets(tasks, sites, cap)` — pass-1 tokens per task:
 *   every task gets HUNT_TASK_TOKEN_MIN, the rest of `cap ×
 *   HUNT_TASK_TOKEN_MEAN` is split in proportion to the sites each task has
 *   to cover, capped at HUNT_TASK_TOKEN_MAX. The sum never exceeds the
 *   pass-1 budget, so the scan total (`huntTokenBudget(cap)`, twice pass 1)
 *   always leaves a retry of every task.
 * - `isOversized(sourceFiles)` — past HUNT_OVERSIZED_SOURCE_FILES even the
 *   top tier covers a corner of the diff; the audit and the coverage line
 *   say so instead of reading as a full hunt.
 *
 * Pure. The site → task attribution is by path (a site inside one of the
 * task's starting points) or by category (a `sink:*` / `entry:*` rule that
 * files under the task's category), so a floor-forced task with no starting
 * points still weighs what its category lit.
 */
import {
  HUNT_MAX_PLANNED_TASKS,
  HUNT_MAX_PLANNED_TASKS_CEILING,
  HUNT_OVERSIZED_SOURCE_FILES,
  HUNT_TASK_CAP_TIERS,
  HUNT_BATCH_WINDOW_CEILING_MS,
  HUNT_TASK_TIME_MS,
  HUNT_TASK_TOKEN_MAX,
  HUNT_TASK_TOKEN_MEAN,
  HUNT_TASK_TOKEN_MIN,
  type HuntCategory,
  type HuntTask,
} from '@/lib/services/security-hunt.config'
import type { HuntSignalSite } from './trigger'
import { SINK_TO_CATEGORY } from './plan-fallback'

/** How many tasks a diff that touched `sourceFiles` source files may plan. */
export function plannedTaskCap(sourceFiles: number): number {
  const n = Number.isFinite(sourceFiles) && sourceFiles > 0 ? sourceFiles : 0
  for (const tier of HUNT_TASK_CAP_TIERS) {
    if (n <= tier.sourceFiles) {
      return Math.min(HUNT_MAX_PLANNED_TASKS_CEILING, tier.tasks)
    }
  }
  return Math.min(HUNT_MAX_PLANNED_TASKS_CEILING, HUNT_MAX_PLANNED_TASKS)
}

export function isOversized(sourceFiles: number): boolean {
  return sourceFiles > HUNT_OVERSIZED_SOURCE_FILES
}

/** Which category a signal site's rule files under, if any. */
export function siteCategory(rule: string): HuntCategory | null {
  if (rule.startsWith('sink:')) {
    return SINK_TO_CATEGORY[rule.slice('sink:'.length)] ?? null
  }
  if (rule.startsWith('entry:')) return 'idor'
  return null
}

/** Distinct sites (path + line) a task has to cover. */
export function taskSiteCount(
  task: Pick<HuntTask, 'category' | 'startingPoints'>,
  sites: ReadonlyArray<HuntSignalSite>
): number {
  const starts = new Set(task.startingPoints)
  const seen = new Set<string>()
  for (const s of sites) {
    if (starts.has(s.path) || siteCategory(s.rule) === task.category) {
      seen.add(`${s.path}:${s.line}`)
    }
  }
  return seen.size
}

export interface TaskAllocation {
  /** Sites the task has to cover (its weight). */
  sites: number
  /** Pass-1 token allowance. */
  tokenBudget: number
  /** Wall clock for the batch, scaled with the allowance (see `taskTimeMs`). */
  timeBudgetMs: number
}

/**
 * A task's window follows its allowance: at the 45k ceiling the replay ran
 * 12 steps in 28–34 s of a 40 s search window, so a token allowance the
 * clock cannot spend is an allowance on paper. HUNT_TASK_TIME_MS at the
 * mean, proportionally more above it, never less than HUNT_TASK_TIME_MS.
 */
export function taskTimeMs(tokenBudget: number): number {
  // LUM-758 (×10): 上界是硬的。一个任务的搜索是一个 `'use step'`，再大的额度
  // 也换不来比 HUNT_BATCH_WINDOW_CEILING_MS 更长的一次执行；超出的部分是纸面
  // 额度，`huntSpendableTokens` 与 budget-arithmetic 把它记在明处。
  return Math.min(
    HUNT_BATCH_WINDOW_CEILING_MS,
    Math.max(
      HUNT_TASK_TIME_MS,
      Math.round((HUNT_TASK_TIME_MS * tokenBudget) / HUNT_TASK_TOKEN_MEAN)
    )
  )
}

/**
 * Pass-1 allowances. Every task gets the floor; the remainder of the pass-1
 * budget (`cap × mean − n × floor`) is split by weight (`max(1, sites)`) and
 * each share capped at the ceiling. Rounded down to whole tokens, so the sum
 * is at most the pass-1 budget.
 */
export function allocateTaskBudgets(
  tasks: ReadonlyArray<Pick<HuntTask, 'id' | 'category' | 'startingPoints'>>,
  sites: ReadonlyArray<HuntSignalSite>,
  cap: number
): Map<string, TaskAllocation> {
  const out = new Map<string, TaskAllocation>()
  if (tasks.length === 0) return out
  const passOne = Math.max(0, cap) * HUNT_TASK_TOKEN_MEAN
  const remainder = Math.max(0, passOne - tasks.length * HUNT_TASK_TOKEN_MIN)
  const weights = tasks.map(t => Math.max(1, taskSiteCount(t, sites)))
  const total = weights.reduce((a, b) => a + b, 0)
  tasks.forEach((t, i) => {
    const share = Math.floor((remainder * weights[i]!) / total)
    const tokenBudget = Math.min(
      HUNT_TASK_TOKEN_MAX,
      HUNT_TASK_TOKEN_MIN + share
    )
    out.set(t.id, {
      sites: taskSiteCount(t, sites),
      tokenBudget,
      timeBudgetMs: taskTimeMs(tokenBudget),
    })
  })
  return out
}
