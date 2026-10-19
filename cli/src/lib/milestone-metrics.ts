import { NONE, fmtTokens, formatDurationSec } from './format'
import { renderListTable } from './list-table'
import {
  fieldLines,
  sectionHeading,
  type DetailOptions,
  type Field,
} from './report-layout'
import { sanitizeField } from './sanitize'
import { DEFAULT_TERMINAL_WIDTH } from './ui'

/**
 * LUM-1190 — the `milestone show` Metrics section: the text twin of the web
 * milestone page's metric strip (`MilestoneMetricStrip.tsx`). Pure rendering
 * of the numbers `/api/milestones/<id>` already computes — no metric is
 * derived here, only picked, sorted and spelled the way the strip does.
 *
 * Honest like the strip: an unmeasured total reads `-` (never a clean 0), a
 * milestone with no PR records says so, and an unsynced diff never reads
 * `+0/−0`.
 */

export interface ModelUsage {
  model: string
  total: number
}

export interface MilestoneMetricsData {
  costRollup?:
    | {
        tokenCost: number | null
        activeTimeSec: number
        measuredTasks: number
        totalTasks: number
      }
    | null
    | undefined
  budget?:
    | {
        tokenBudget: number
        tokenCost: number | null
        usedRatio: number | null
        exceeded: boolean | null
        overBy: number | null
      }
    | null
    | undefined
  deliveryStats?:
    | {
        pr: {
          mergedPrCount: number
          multiPrTaskCount: number
          linkedTaskCount: number
        }
        perTask?:
          | {
              rows: Array<{
                taskId: string
                ref: string | null
                title: string | null
                tokenCost: number | null
                models?: ModelUsage[] | undefined
                modelUnattributedTokens?: number | undefined
                activeTimeSec: number
                prCount: number
                multiPr: boolean
                changeVolume: { additions: number; deletions: number } | null
              }>
            }
          | undefined
      }
    | null
    | undefined
}

type TaskRow = NonNullable<
  NonNullable<MilestoneMetricsData['deliveryStats']>['perTask']
>['rows'][number]

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/**
 * Per-model split the way the strip lists it: the top three models, then
 * `+N more models · <total>`, then the spend no model can claim. `''` when the
 * row carries no model data (the strip renders no bars then either).
 */
export function formatModelSplit(
  models: ModelUsage[] | undefined,
  unattributedTokens?: number
): string {
  const parts: string[] = []
  for (const m of (models ?? []).slice(0, 3)) {
    parts.push(`${sanitizeField(m.model)} ${fmtTokens(m.total)}`)
  }
  const rest = (models ?? []).slice(3)
  if (rest.length > 0) {
    const restTotal = rest.reduce((sum, m) => sum + m.total, 0)
    parts.push(
      `+${plural(rest.length, 'more model', 'more models')} ${fmtTokens(restTotal)}`
    )
  }
  if ((unattributedTokens ?? 0) > 0) {
    parts.push(
      `${fmtTokens(unattributedTokens ?? 0)} not attributed to a model`
    )
  }
  return parts.join(' · ')
}

/** The strip's chip values + the budget and rework lines, as `Label: value` rows. */
function totalFields(m: MilestoneMetricsData): Field[] {
  const fields: Field[] = []
  const cost = m.costRollup
  if (cost) {
    const coverage = `measured on ${cost.measuredTasks} of ${cost.totalTasks} tasks`
    fields.push({
      label: 'Tokens',
      value: `${cost.tokenCost === null ? NONE : fmtTokens(cost.tokenCost)}  (${coverage})`,
    })
    const budget = m.budget
    if (budget) {
      const of = `of ${fmtTokens(budget.tokenBudget)} token budget`
      let value =
        budget.usedRatio === null
          ? `${NONE} ${of} (burn not measured)`
          : `${Math.round(budget.usedRatio * 100)}% ${of}`
      if (budget.exceeded && budget.overBy !== null) {
        value += `  (over budget by ${fmtTokens(budget.overBy)})`
      }
      fields.push({ label: 'Budget', value })
    }
    // Spend is only honest when something was measured — zero measured tasks
    // would otherwise read a clean 0s.
    fields.push({
      label: 'Active time',
      value: `${cost.measuredTasks > 0 ? formatDurationSec(cost.activeTimeSec) : NONE}  (non-idle session time)`,
    })
  }
  const pr = m.deliveryStats?.pr
  if (pr) {
    fields.push({
      label: 'Merged PRs',
      value:
        pr.linkedTaskCount === 0
          ? 'No PRs on record'
          : `${pr.mergedPrCount}  (rework: ${plural(pr.multiPrTaskCount, 'task', 'tasks')} with more than one PR)`,
    })
  }
  return fields
}

const taskRef = (row: TaskRow) =>
  row.ref ? sanitizeField(row.ref) : row.taskId.slice(0, 8)

/** Rows listed per `By task` block (top by that block's number). */
export const BY_TASK_SHOWN = 10

interface ByTaskRow {
  /** Leading cells (ref + figures); the title is appended as the last column. */
  cells: string[]
  title: string
  /** Optional line printed under the row (the per-model split). */
  detail?: string
}

/**
 * One `By task — <metric>` block: a sub-heading, then the top
 * {@link BY_TASK_SHOWN} rows — figures first and the title last, so piped
 * output never pads a long title in front of the numbers — and a count of the
 * rest. The title is the column cut to the width on a TTY.
 */
function byTaskBlock(
  title: string,
  rows: ByTaskRow[],
  header: string[],
  empty: string,
  opts: DetailOptions
): string[] {
  const lines = ['', `  By task — ${title}`]
  if (rows.length === 0) return [...lines, `    ${empty}`]
  const shown = rows.slice(0, BY_TASK_SHOWN)
  const tty = opts.tty === true
  const table = renderListTable(
    shown.map(r => [...r.cells, r.title]),
    {
      header,
      flex: header.length - 1,
      tty,
      color: opts.color === true,
      width: (opts.width ?? DEFAULT_TERMINAL_WIDTH) - 4,
    }
  )
  const rendered = table.split('\n')
  // On a TTY the first rendered line is the header row.
  const offset = rendered.length - shown.length
  // A table whose rows carry a detail (the tokens table's model split) gives
  // EVERY piped row that field — `-` when a row has none — so all rows have
  // the same number of TAB fields (L-3, V-1).
  const hasDetail = shown.some(r => r.detail !== undefined)
  rendered.forEach((line, i) => {
    const detail = i >= offset ? shown[i - offset]?.detail : undefined
    // LUM-1232 L-3: piped, a row stays one line — its detail rides as one
    // more TAB field; on a TTY it goes on the line under the row.
    if (!tty) {
      const extra = hasDetail && i >= offset ? `\t${detail || NONE}` : ''
      lines.push(line ? `    ${line}${extra}` : '')
      return
    }
    lines.push(line ? `    ${line}` : '')
    if (detail) lines.push(`      ${detail}`)
  })
  const hidden = rows.length - shown.length
  if (hidden > 0) {
    // LUM-1232 PG-1: say what was shown; `--json` carries every task.
    lines.push(
      `    Showing ${shown.length} of ${rows.length} (all of them in --json).`
    )
  }
  return lines
}

/**
 * The BY TASK breakdowns behind the strip's three chips, each sorted by the
 * number it shows (the strip's ordering): tasks with measured tokens (with
 * the per-model split under each), tasks with active time, tasks with a
 * linked PR.
 */
function byTaskLines(m: MilestoneMetricsData, opts: DetailOptions): string[] {
  const perTask = m.deliveryStats?.perTask
  if (!perTask) return []
  const rows = perTask.rows
  const lines: string[] = []
  const titleOf = (r: TaskRow) => sanitizeField(r.title ?? '')

  if (m.costRollup) {
    const tokenRows = rows
      .filter(r => r.tokenCost !== null)
      .sort((a, b) => (b.tokenCost ?? 0) - (a.tokenCost ?? 0))
      .map(r => ({
        cells: [taskRef(r), `${fmtTokens(r.tokenCost ?? 0)} tokens`],
        title: titleOf(r),
        detail: formatModelSplit(r.models, r.modelUnattributedTokens),
      }))
    lines.push(
      ...byTaskBlock(
        'tokens',
        tokenRows,
        ['TASK', 'TOKENS', 'TITLE'],
        'Not measured.',
        opts
      )
    )
    const timeRows = rows
      .filter(r => r.activeTimeSec > 0)
      .sort((a, b) => b.activeTimeSec - a.activeTimeSec)
      .map(r => ({
        cells: [taskRef(r), formatDurationSec(r.activeTimeSec)],
        title: titleOf(r),
      }))
    lines.push(
      ...byTaskBlock(
        'active time',
        timeRows,
        ['TASK', 'ACTIVE', 'TITLE'],
        'Not measured.',
        opts
      )
    )
  }

  const prRows = rows
    .filter(r => r.prCount > 0)
    .sort((a, b) => b.prCount - a.prCount)
    .map(r => ({
      cells: [
        taskRef(r),
        plural(r.prCount, 'PR', 'PRs'),
        r.multiPr ? 'multi-PR' : NONE,
        r.changeVolume
          ? `+${fmtTokens(r.changeVolume.additions)}/−${fmtTokens(r.changeVolume.deletions)}`
          : 'no synced PRs',
      ],
      title: titleOf(r),
    }))
  lines.push(
    ...byTaskBlock(
      'PRs',
      prRows,
      ['TASK', 'PRS', 'REWORK', 'CHANGE', 'TITLE'],
      'No PRs on record.',
      opts
    )
  )
  return lines
}

/**
 * The whole Metrics section, or `[]` when the server sent neither the cost
 * rollup nor the delivery stats (an older server — the strip renders nothing
 * then too).
 */
export function milestoneMetricsLines(
  m: MilestoneMetricsData,
  opts: DetailOptions = {}
): string[] {
  if (!m.costRollup && !m.deliveryStats) return []
  return [
    ...sectionHeading('Metrics', opts),
    ...fieldLines(totalFields(m), 2, opts),
    ...byTaskLines(m, opts),
  ]
}
