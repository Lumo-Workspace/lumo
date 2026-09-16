/**
 * LUM-762 — the read side of `PrSecurityScan.huntAudit`.
 *
 * The audit has been written since LUM-739 but never read: no API, no UI, so
 * "what actually ran, and how long does a healthy batch take" could only be
 * answered by paging through Vercel logs. `lumo task status` answers it from
 * this.
 *
 * LUM-758 — the unit of work is a PLANNED TASK, so rows are grouped by
 * `taskId`, not by category. Two tasks may legitimately share a category
 * (same closed output type, different objectives); grouping by category would
 * fold them into one row, report a two-attempt "retry" that never happened,
 * and — because `total` counts PLANNED TASKS — make a fully-`done` layer
 * read as `2/3 done`. Rows without a `taskId` (pre-task-graph audits) still
 * group by category, which is exactly how they were written.
 *
 * Pure and defensive: the column is raw Json written by past versions of the
 * workflow, so every row is validated against the current category list and
 * stop vocabulary, and anything unrecognised is dropped rather than trusted or
 * thrown over. A task the retry pass re-ran has one row per attempt, in
 * attempt order — the last row is its outcome, the elapsed times add up.
 */
import {
  HUNT_CATEGORIES,
  type HuntCategory,
  type HuntCategoryStop,
} from '@/lib/services/security-hunt.config'

const STOPS: readonly HuntCategoryStop[] = [
  'done',
  'steps',
  'budget',
  // LUM-799 — a row this list does not know is DROPPED, so a stop reason that
  // ships without being added here makes the task disappear from the coverage
  // line rather than read as unrecognised.
  'no-progress',
  'timeout',
  'error',
  'skipped',
]

/**
 * One planned task's outcome, collapsed over its attempts. The name and the
 * `category` field are frozen: the CLI (`lumo task status`, a separate
 * package with its own copy of this shape) renders these rows, and an older
 * CLI must keep working against a newer server.
 */
export interface HuntCategoryCoverage {
  /** LUM-758 — absent on pre-task-graph audit rows. */
  taskId?: string
  objective?: string
  category: HuntCategory
  /** The last attempt's stop reason. */
  stopped: HuntCategoryStop
  /**
   * Summed over every attempt — what this task cost the scan, in wall clock
   * and in gateway tokens. A retried task really did spend both twice, and
   * `tokenSpent` (the acceptance metric's own number) counts them the same
   * way.
   *
   * LUM-758 fifth review: this sentence used to cover `candidates` as well,
   * and only `elapsedMs` was actually accumulated — a false comment in the
   * one file whose whole job is the launch read-out. `tokens` now matches
   * what it says; `candidates` says its own thing below.
   */
  elapsedMs: number
  tokens: number
  /**
   * The LAST attempt's count, deliberately not a sum: a retry REPLACES the
   * task's outcome (`stopped` is the last attempt's too), so a timed-out
   * attempt's candidates and the re-run's are the same findings counted
   * twice, not two findings.
   */
  candidates: number
  /** 1, or 2 when the workflow's retry pass re-ran it. */
  attempts: number
}

export interface HuntCoverage {
  /** LUM-787 follow-up — the diff exceeded HUNT_OVERSIZED_SOURCE_FILES; the hunt covered a corner. */
  oversized?: { sourceFiles: number }
  /**
   * LUM-758 — how many tasks the planning step picked for this scan
   * (`audit.planned.length`), not `HUNT_CATEGORIES.length`: a scan plans
   * 0–3, so "out of 6" understates a fully-run layer. A pre-LUM-758 row has
   * no `planned` field and falls back to `HUNT_CATEGORIES.length`.
   */
  total: number
  /**
   * How many ended `done` — `done === total` is the whole layer. Counted
   * over the same unit as `total` (planned tasks), which is why the rows
   * below are grouped by `taskId` and not by category.
   */
  done: number
  /** Recorded tasks, in the order the workflow attempted them. */
  categories: HuntCategoryCoverage[]
}

function isCategory(value: unknown): value is HuntCategory {
  return HUNT_CATEGORIES.includes(value as HuntCategory)
}

function isStop(value: unknown): value is HuntCategoryStop {
  return STOPS.includes(value as HuntCategoryStop)
}

/** A count we can print: finite, non-negative, integral. Anything else → 0. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0
}

/** Free text straight off a Json column — only trusted when it is a string. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * `huntAudit` → per-category coverage, or null when the column holds nothing
 * usable (absent, a pre-LUM-739 row, an error-only audit, or garbage).
 */
export function parseHuntCoverage(raw: unknown): HuntCoverage | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  // LUM-758 renamed `HuntAudit.categories` to `.tasks`. Rows persisted before
  // that rename still carry the old field name — fall back to it so those
  // rows keep rendering instead of silently losing their coverage line.
  const rows =
    (raw as { tasks?: unknown; categories?: unknown }).tasks ??
    (raw as { categories?: unknown }).categories
  if (!Array.isArray(rows)) return null

  // Insertion-ordered: the audit is written in attempt order, which is plan
  // order, and that is the order a human wants to read the layer back in.
  // (Pre-task-graph audits were written in HUNT_CATEGORIES order, so those
  // rows come out in exactly the order they always did.)
  const byTask = new Map<string, HuntCategoryCoverage>()
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const cells = row as Record<string, unknown>
    const { category, stopped } = cells
    if (!isCategory(category) || !isStop(stopped)) continue
    const taskId = text(cells.taskId)
    const objective = text(cells.objective)
    // A row with no taskId predates the task graph — key it by category, the
    // identity it actually had when it was written.
    const key = taskId ?? `category:${category}`
    const prior = byTask.get(key)
    byTask.set(key, {
      ...(taskId === undefined ? {} : { taskId }),
      ...(objective === undefined ? {} : { objective }),
      category,
      stopped,
      elapsedMs: (prior?.elapsedMs ?? 0) + count(cells.elapsedMs),
      tokens: (prior?.tokens ?? 0) + count(cells.tokens),
      // Last attempt wins — see the field's comment: a retry replaces the
      // outcome, it does not add a second set of findings.
      candidates: count(cells.candidates),
      attempts: (prior?.attempts ?? 0) + 1,
    })
  }
  if (byTask.size === 0) return null

  const categories = [...byTask.values()]

  // LUM-758: the denominator is what the planning step planned, not the full
  // category list. `planned` is now an array of `HuntTask` objects (was
  // `HuntCategory[]` pre-task-graph) — either way its length is the plan
  // size, so just count entries rather than re-validating shape. `planned`
  // is absent on pre-LUM-758 rows — fall back to HUNT_CATEGORIES.length so
  // those still render sensibly. Grouping by task above is what keeps this
  // denominator commensurable with `done`.
  const planned = (raw as { planned?: unknown }).planned
  const total = Array.isArray(planned) ? planned.length : HUNT_CATEGORIES.length

  // LUM-787 follow-up — a diff past the size the top tier can cover is
  // said so on the line, whatever the tasks' stops read.
  const diff = (raw as { diff?: unknown }).diff
  const oversized =
    diff !== null &&
    typeof diff === 'object' &&
    (diff as { oversized?: unknown }).oversized === true
      ? { sourceFiles: count((diff as { sourceFiles?: unknown }).sourceFiles) }
      : undefined

  return {
    total,
    done: categories.filter(c => c.stopped === 'done').length,
    categories,
    ...(oversized ? { oversized } : {}),
  }
}

/**
 * One line a human can read in a deploy log or a status pane:
 * `2/3 done · t1 idor 41.2s done · t2 injection 72.0s done (2 attempts)`.
 * Kept beside the parser so the log line and the API payload describe a task
 * the same way. (`lumo task status` renders its own copy — the CLI is a
 * separate package and never imports from `lib/`.)
 */
export function formatHuntCoverage(coverage: HuntCoverage): string {
  const parts = coverage.categories.map(c => {
    const attempts = c.attempts > 1 ? ` (${c.attempts} attempts)` : ''
    const spent =
      c.stopped === 'skipped' ? '' : `${(c.elapsedMs / 1000).toFixed(1)}s `
    // LUM-758: two rows can share a category, so the task id is what tells
    // them apart. Absent on pre-task-graph rows — the line drops it then.
    const id = c.taskId === undefined ? '' : `${c.taskId} `
    return `${id}${c.category} ${spent}${c.stopped}${attempts}`
  })
  const oversized = coverage.oversized
    ? [
        `oversized (${coverage.oversized.sourceFiles} source files, partial coverage)`,
      ]
    : []
  return [
    `${coverage.done}/${coverage.total} done`,
    ...parts,
    ...oversized,
  ].join(' · ')
}
