import {
  NONE,
  fmtCalendarDay,
  fmtDay,
  fmtDayRange,
  fmtTokens,
  formatDurationSec,
} from './format'
import { formatModelSplit, type ModelUsage } from './milestone-metrics'
import {
  fieldLines,
  indentLines,
  reportWidth,
  sectionHeading,
  type DetailOptions,
} from './report-layout'
import { sanitizeField } from './sanitize'
import { renderTable, truncate } from './ui'
import { renderListTable } from './list-table'

/**
 * LUM-1190 — the `sprint show` Burnup and Team performance sections. Pure
 * rendering of what `/api/sprints/<id>/burnup` and `/team-performance`
 * compute (the web sprint page dropped these panels in LUM-1279; the API and
 * this CLI view stay).
 */

export interface SprintBurnupData {
  start: string
  end: string
  scopeTotal: number
  /** `date` is a UTC calendar-day key (`YYYY-MM-DD`, LUM-700). */
  series: Array<{ date: string; scope: number; completed: number | null }>
}

export interface SprintTeamPerformanceData {
  measuredTasks: number
  /** `null` = token side unmeasured — never a fabricated 0. */
  totalTokenCost: number | null
  totalActiveTimeSec: number
  totalRuns: number
  rows: Array<{
    memberId: string | null
    label: string | null
    tasksDone: number
    tokenCost: number
    activeTimeSec: number
    runs: number
    perTask: Array<{
      identifier: string
      title: string
      tokenCost: number
      activeTimeSec: number
      models: ModelUsage[]
      updatedAt: string
    }>
  }>
}

/** A secondary read the command could not get — rendered, never fatal. */
export interface ReadFailure {
  error: string
}

// ── response-shape guards ──────────────────────────────────────────────────
// The two payloads come off the wire; a body that does not carry the fields
// the renderers read takes the same `Could not read` path as an HTTP error
// instead of crashing the whole `sprint show` on a property access.

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNumOrNull = (v: unknown) => v === null || isNum(v)
const isStrOrNull = (v: unknown) => v === null || isStr(v)
const everyItem = (v: unknown, ok: (item: unknown) => boolean) =>
  Array.isArray(v) && v.every(ok)

/** True when `body` has the fields {@link sprintBurnupLines} reads. */
export function isSprintBurnupData(body: unknown): body is SprintBurnupData {
  return (
    isObj(body) &&
    isStr(body.start) &&
    isStr(body.end) &&
    isNum(body.scopeTotal) &&
    everyItem(
      body.series,
      p =>
        isObj(p) && isStr(p.date) && isNum(p.scope) && isNumOrNull(p.completed)
    )
  )
}

const isModelUsage = (m: unknown) =>
  isObj(m) && isStr(m.model) && isNum(m.total)

/** True when `body` has the fields {@link sprintTeamPerformanceLines} reads. */
export function isSprintTeamPerformanceData(
  body: unknown
): body is SprintTeamPerformanceData {
  return (
    isObj(body) &&
    isNum(body.measuredTasks) &&
    isNumOrNull(body.totalTokenCost) &&
    isNum(body.totalActiveTimeSec) &&
    isNum(body.totalRuns) &&
    everyItem(
      body.rows,
      r =>
        isObj(r) &&
        isStrOrNull(r.label) &&
        isNum(r.tasksDone) &&
        isNum(r.tokenCost) &&
        isNum(r.activeTimeSec) &&
        isNum(r.runs) &&
        everyItem(
          r.perTask,
          t =>
            isObj(t) &&
            isStr(t.identifier) &&
            isStr(t.title) &&
            isNum(t.tokenCost) &&
            isNum(t.activeTimeSec) &&
            isStr(t.updatedAt) &&
            everyItem(t.models, isModelUsage)
        )
    )
  )
}

/** Tasks listed under each member in Team performance (top by tokens). */
export const TEAM_TASKS_SHOWN = 5
/** TTY cap for a task row's per-model split (the title needs the rest). */
const MODELS_TTY_WIDTH = 28

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** Plan values land on halves; measured ones are whole tasks (web `fmtCount`). */
export function fmtTaskCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * The straight-line plan the web chart draws: 0 on the first day, the scope
 * on the last (`scopeTotal · i / (n − 1)`).
 */
export function burnupPlan(scopeTotal: number, i: number, n: number): number {
  return n < 2 ? scopeTotal : (scopeTotal * i) / (n - 1)
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/**
 * One character per day of `completed`, scaled like the web chart (the larger
 * of the scope and the curve's own peak); a day not measured yet (the future
 * of an ACTIVE sprint) reads `·`.
 */
export function burnupSparkline(
  series: SprintBurnupData['series'],
  scopeTotal: number
): string {
  const measured = series.flatMap(p =>
    p.completed === null ? [] : [p.completed]
  )
  const maxY = Math.max(scopeTotal, ...measured, 1)
  return series
    .map(p => {
      if (p.completed === null) return '·'
      const idx = Math.round((p.completed / maxY) * (SPARK.length - 1))
      return SPARK[Math.max(0, Math.min(SPARK.length - 1, idx))]
    })
    .join('')
}

function failureLines(f: ReadFailure): string[] {
  return [`  Could not read (${sanitizeField(f.error)}).`]
}

/**
 * Burnup: the latest measured day as `Done: c / scope`, the per-day curve as a
 * sparkline, then one row per day — scope, done (`-` for a day not measured
 * yet) and the straight-line plan. The day column is the server's UTC
 * calendar-day key, shown as-is (never shifted to the local zone).
 */
export function sprintBurnupLines(
  burnup: SprintBurnupData | ReadFailure | undefined,
  opts: DetailOptions = {}
): string[] {
  if (!burnup) return []
  const lines = sectionHeading('Burnup', opts)
  if ('error' in burnup) return [...lines, ...failureLines(burnup)]
  const { series, scopeTotal } = burnup
  if (series.length === 0) return [...lines, '  Not enough data yet.']

  const lastMeasured = [...series].reverse().find(p => p.completed !== null)
  lines.push(
    ...fieldLines(
      [
        {
          label: 'Done',
          value: lastMeasured
            ? `${lastMeasured.completed}/${scopeTotal}  (as of ${fmtCalendarDay(lastMeasured.date)})`
            : `${NONE}/${scopeTotal}  (nothing measured yet)`,
        },
        {
          label: 'Trend',
          value: `${burnupSparkline(series, scopeTotal)}  ${fmtDayRange(burnup.start, burnup.end)}`,
          whole: true,
        },
      ],
      2,
      opts
    )
  )
  const n = series.length
  const rows = series.map((p, i) => [
    fmtCalendarDay(p.date),
    String(p.scope),
    p.completed === null ? NONE : String(p.completed),
    fmtTaskCount(burnupPlan(scopeTotal, i, n)),
  ])
  // Numbers only, so the header prints piped too — a headerless column of
  // digits would not say which is scope and which is done.
  const table = renderTable(rows, {
    header: ['DAY', 'SCOPE', 'DONE', 'PLAN'],
    align: [undefined, 'right', 'right', 'right'],
    color: opts.color === true,
  })
  return [...lines, '', ...indentLines(table, 2)]
}

/**
 * Team performance: the sprint totals, then one block per member (the web
 * card's name · token share · tasks done · tokens · agent time, plus runs)
 * with that member's top tasks by tokens under it. When the token side is unmeasured
 * (`totalTokenCost: null`) tokens and share read `-`, not 0.
 */
export function sprintTeamPerformanceLines(
  perf: SprintTeamPerformanceData | ReadFailure | undefined,
  opts: DetailOptions = {}
): string[] {
  if (!perf) return []
  const lines = sectionHeading('Team performance', opts)
  if ('error' in perf) return [...lines, ...failureLines(perf)]
  if (perf.rows.length === 0) {
    return [...lines, '  None — no agent work recorded on this sprint.']
  }
  const total = perf.totalTokenCost
  const tokens = (n: number) => (total === null ? NONE : fmtTokens(n))
  const share = (n: number) =>
    total === null ? NONE : `${total > 0 ? Math.round((n / total) * 100) : 0}%`

  lines.push(
    ...fieldLines(
      [
        {
          label: 'Total',
          value: `${tokens(total ?? 0)} tokens · ${formatDurationSec(perf.totalActiveTimeSec)} agent time · ${plural(perf.totalRuns, 'run', 'runs')}  (measured on ${plural(perf.measuredTasks, 'task', 'tasks')})`,
        },
      ],
      2,
      opts
    )
  )

  // On a TTY long lines are cut to the width; piped output stays whole
  // (the LUM-1089 list policy — agents read it as plain text).
  const fit = (text: string, max: number) =>
    opts.tty === true ? truncate(text, max) : text
  const width = reportWidth(opts)
  for (const row of perf.rows) {
    const name = row.label ? sanitizeField(row.label) : 'Unattributed'
    lines.push(
      '',
      fit(
        `  ${name}  ${share(row.tokenCost)} · ${plural(row.tasksDone, 'task', 'tasks')} done · ${tokens(row.tokenCost)} tokens · ${formatDurationSec(row.activeTimeSec)} agent time · ${plural(row.runs, 'run', 'runs')}`,
        width
      )
    )
    if (row.perTask.length === 0) continue
    // The server sorts a member's tasks by tokens desc; the top few carry the
    // story (the web drill-down is collapsed by default), the rest is counted.
    const shown = row.perTask.slice(0, TEAM_TASKS_SHOWN)
    // LUM-1232 batch A (L-2/L-5): the shared list renderer with the title as
    // the last, flexible column — the per-model split moves before it;
    // piped rows are TAB-separated.
    const taskRows = shown.map(t => [
      sanitizeField(t.identifier),
      tokens(t.tokenCost),
      formatDurationSec(t.activeTimeSec),
      fmtDay(t.updatedAt),
      // On a TTY the split is capped so the title keeps room; piped it is whole.
      fit(
        total === null
          ? NONE
          : formatModelSplit(t.models, remainder(t)) || NONE,
        MODELS_TTY_WIDTH
      ),
      sanitizeField(t.title),
    ])
    const table = renderListTable(taskRows, {
      header: ['ID', 'TOKENS', 'AGENT TIME', 'DONE', 'MODELS', 'TITLE'],
      flex: 5,
      tty: opts.tty === true,
      color: opts.color === true,
      width: width - 4,
    })
    // A long MODELS cell can still outgrow a narrow terminal: on a TTY the
    // rendered line is cut at the width (the title, last, goes first).
    lines.push(
      ...indentLines(
        table
          .split('\n')
          .map(l => fit(l, width - 4))
          .join('\n'),
        4
      )
    )
    const hidden = row.perTask.length - shown.length
    if (hidden > 0) {
      // LUM-1232 PG-1: say what was shown; `--json` carries every task.
      lines.push(
        `    Showing ${shown.length} of ${row.perTask.length} (all of them in --json).`
      )
    }
  }
  return lines
}

/** Spend the per-model split can't place (pre-LUM-298 sessions), stated. */
function remainder(t: { tokenCost: number; models: ModelUsage[] }): number {
  return Math.max(
    0,
    t.tokenCost - t.models.reduce((sum, m) => sum + m.total, 0)
  )
}
