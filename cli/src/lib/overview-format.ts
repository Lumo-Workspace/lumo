import {
  fmtCalendarDay,
  fmtTimestamp,
  formatDurationHours,
  NONE,
} from './format'
import {
  fieldLines,
  labelWidth,
  sectionHeading,
  wrapLines,
  type Field,
  type LayoutOptions,
} from './report-layout'
import { sanitizeField } from './sanitize'
import { renderTable, truncate } from './ui'

/**
 * LUM-1192 — the read-only project overview, rendered from what
 * `GET /api/stats/project/*` and `GET /api/summaries/project/*` return. Every
 * number is the server's; this module only lays it out (same cut as the web:
 * the last 7 days of the completion trend).
 */

export interface StalledItem {
  id: string
  identifier: string
  title: string
  updatedAt?: string
}

export interface OverviewStats {
  totalTasks: number
  statusDistribution: Record<string, number>
  overdueTasks: { count: number }
  memberWorkload: Array<{ name: string; assigned: number; completed: number }>
  completionTrend: Array<{ date: string; completed: number }>
  avgCompletionTime: number | null
  topBlockers?: {
    stalledTaskIds: StalledItem[]
    highStakesTaskIds: StalledItem[]
    staleOpenPrs: Array<{ number: number; openedAt: string; url: string }>
  }
}

export interface OverviewSummary {
  tldr: string
  report: string
  generatedAt: string
}

export interface OverviewOptions extends LayoutOptions {
  /** Print the full stored report under the summary's TL;DR. */
  report?: boolean
  /** LUM-1285: the project's lifecycle fields; omitted on an older server. */
  lifecycle?: ProjectLifecycleView | undefined
}

/** LUM-1285: what `GET /api/projects` carries about a project's lifecycle. */
export interface ProjectLifecycleView {
  status: string
  startDate?: string | null | undefined
  targetDate?: string | null | undefined
  archivedAt?: string | null | undefined
  /** Derived by the server: ≥1 task and none open. */
  completed?: boolean | undefined
}

/**
 * LUM-1285: the State / Start / Target / Complete block. Status is a human
 * ruling; "Complete" is derived from the tasks and never stored.
 */
export function lifecycleLines(
  p: ProjectLifecycleView,
  opts: LayoutOptions = {}
): string[] {
  const state = p.archivedAt
    ? `${p.status} · archived ${fmtCalendarDay(p.archivedAt)}`
    : p.status
  const fields: Field[] = [
    { label: 'State', value: state },
    { label: 'Start', value: fmtCalendarDay(p.startDate) },
    { label: 'Target', value: fmtCalendarDay(p.targetDate) },
    {
      label: 'Complete',
      value:
        p.completed === undefined
          ? NONE
          : p.completed
            ? 'yes (every task done)'
            : 'no',
    },
  ]
  return fieldLines(fields, 0, opts, labelWidth(fields))
}

/** The web's status order (StatusDistributionChart); others follow, A→Z. */
export const STATUS_ORDER = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const

/** How many trailing days of the completion trend the web chart shows. */
export const TREND_DAYS = 7

/** `BACKLOG 2 · TODO 3 · …` — every status the server counted, web order first. */
export function statusLine(dist: Record<string, number>): string {
  const known = STATUS_ORDER as readonly string[]
  const extra = Object.keys(dist)
    .filter(k => !known.includes(k))
    .sort()
  return [...known, ...extra].map(k => `${k} ${dist[k] ?? 0}`).join(' · ')
}

/** Average hours to DONE, one decimal (as the web card), or `N/A`. */
export function avgCompletionLabel(hours: number | null): string {
  // LUM-1232 N-3: `1301h 6m`, never fractional hours or days; absent → `-` (V-1).
  return formatDurationHours(hours)
}

/** One line: no control characters, whitespace runs collapsed. */
function oneLine(text: string): string {
  return sanitizeField(text).replace(/\s+/g, ' ').trim()
}

function statsLines(s: OverviewStats, opts: LayoutOptions): string[] {
  const fields: Field[] = [
    { label: 'Total tasks', value: String(s.totalTasks) },
    { label: 'Completed', value: String(s.statusDistribution.DONE ?? 0) },
    { label: 'Overdue', value: String(s.overdueTasks.count) },
    { label: 'Avg completion', value: avgCompletionLabel(s.avgCompletionTime) },
    { label: 'Status', value: statusLine(s.statusDistribution) },
  ]
  return fieldLines(fields, 0, opts, labelWidth(fields))
}

function workloadLines(s: OverviewStats, opts: LayoutOptions): string[] {
  const lines = sectionHeading('Workload', opts)
  if (s.memberWorkload.length === 0)
    return [...lines, '  None — no assigned task.']
  const table = renderTable(
    s.memberWorkload.map(m => [
      oneLine(m.name),
      String(m.assigned),
      String(m.completed),
    ]),
    {
      header: ['MEMBER', 'ASSIGNED', 'COMPLETED'],
      align: ['left', 'right', 'right'],
      color: opts.color === true,
    }
  )
  return [...lines, ...table.split('\n').map(l => `  ${l}`)]
}

function trendLines(s: OverviewStats, opts: LayoutOptions): string[] {
  const lines = sectionHeading(
    `Completed (last ${TREND_DAYS} active days)`,
    opts
  )
  const last = s.completionTrend.slice(-TREND_DAYS)
  if (last.length === 0)
    return [...lines, '  None — nothing completed recently.']
  return [
    ...lines,
    ...last.map(t => `  ${fmtCalendarDay(t.date)}  ${t.completed}`),
  ]
}

/** Whole days since `iso` at `now` (floored at 0) — the web's IDLE column. */
export function idleDaysSince(iso: string | undefined, now: Date): string {
  if (!iso) return NONE
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return NONE
  return `${Math.max(0, Math.floor((now.getTime() - then) / 86_400_000))}d`
}

/**
 * The project page's health row: stalled / high-stakes / stale PRs / overdue
 * counts, then the stalled tasks and stale PRs themselves.
 */
function healthLines(
  s: OverviewStats,
  now: Date,
  opts: LayoutOptions
): string[] {
  const b = s.topBlockers
  if (!b) return []
  const lines = [
    ...sectionHeading('Health', opts),
    `  Stalled ${b.stalledTaskIds.length} · High stakes ${b.highStakesTaskIds.length} · Stale PRs ${b.staleOpenPrs.length} · Overdue ${s.overdueTasks.count}`,
  ]
  const item = (t: StalledItem) =>
    `    ${t.identifier}  ${truncate(oneLine(t.title), 60)}  idle ${idleDaysSince(t.updatedAt, now)}`
  if (b.highStakesTaskIds.length > 0) {
    lines.push('  High stakes:', ...b.highStakesTaskIds.map(item))
  }
  if (b.stalledTaskIds.length > 0) {
    lines.push('  Stalled:', ...b.stalledTaskIds.map(item))
  }
  if (b.staleOpenPrs.length > 0) {
    lines.push(
      '  Stale PRs:',
      ...b.staleOpenPrs.map(
        p => `    #${p.number}  opened ${fmtCalendarDay(p.openedAt)}  ${p.url}`
      )
    )
  }
  return lines
}

function briefingLines(
  title: string,
  summary: OverviewSummary | null,
  opts: OverviewOptions
): string[] {
  const lines = sectionHeading(title, opts)
  if (!summary) return [...lines, '  None generated yet.']
  lines.push(`  Generated ${fmtTimestamp(summary.generatedAt)}`)
  lines.push(...wrapLines(oneLine(summary.tldr), 2, opts))
  if (opts.report && summary.report.trim()) {
    lines.push('')
    for (const para of sanitizeField(summary.report).split('\n')) {
      lines.push(...(para.trim() ? wrapLines(para, 2, opts) : ['']))
    }
  }
  return lines
}

/** `lumo project show` — the project page's health and stats as text. */
export function formatProjectOverview(
  projectName: string,
  stats: OverviewStats,
  summary: OverviewSummary | null,
  now: Date,
  opts: OverviewOptions = {}
): string {
  return [
    `Project: ${oneLine(projectName)}`,
    '',
    ...(opts.lifecycle ? [...lifecycleLines(opts.lifecycle, opts), ''] : []),
    ...statsLines(stats, opts),
    ...healthLines(stats, now, opts),
    ...workloadLines(stats, opts),
    ...trendLines(stats, opts),
    ...briefingLines('Summary', summary, opts),
  ].join('\n')
}
