import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { fmtCalendarDay, fmtDay, type TaskRow } from '../lib/format'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  fieldLines,
  labelWidth,
  reportWidth,
  sectionHeading,
  type DetailOptions,
  type Field,
} from '../lib/report-layout'
import { taskTableSection } from '../lib/detail-layout'
import {
  isSprintBurnupData,
  isSprintTeamPerformanceData,
  sprintBurnupLines,
  sprintTeamPerformanceLines,
  type ReadFailure,
  type SprintBurnupData,
  type SprintTeamPerformanceData,
} from '../lib/sprint-metrics'
import {
  colorEnabled,
  enumColor,
  heading,
  terminalWidth,
  truncate,
} from '../lib/ui'

export interface ShowSprintOptions {
  team?: string
}

export interface SprintShowData {
  id: string
  number: number
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  startedAt: string | null
  closedAt: string | null
  team: { id: string; name: string }
}

interface SprintBlockerItem {
  id: string
  identifier: string
  title: string
}

export interface SprintBlockers {
  overdueTaskIds: SprintBlockerItem[]
  stalledTaskIds: SprintBlockerItem[]
  failingAgentTaskIds: SprintBlockerItem[]
  staleOpenPrNumbers: number[]
}

/** LUM-1190: the burnup / team-performance reads (each may have failed). */
export interface SprintMetrics {
  burnup?: SprintBurnupData | ReadFailure | undefined
  teamPerformance?: SprintTeamPerformanceData | ReadFailure | undefined
}

const BLOCKER_LABELS = {
  overdue: 'Overdue',
  stalled: 'Stalled',
  agentFail: 'Agent fail',
  stalePrs: 'Stale PRs',
} as const

/**
 * LUM-1090: one blocker per line — `LUM-1 Fix login` — aligned under the
 * value column of its category row, each cut with `…` to the report width.
 */
function blockerLines(b: SprintBlockers, opts: DetailOptions): string[] {
  const groups: Array<[string, string[]]> = [
    [BLOCKER_LABELS.overdue, b.overdueTaskIds.map(blockerItem)],
    [BLOCKER_LABELS.stalled, b.stalledTaskIds.map(blockerItem)],
    [BLOCKER_LABELS.agentFail, b.failingAgentTaskIds.map(blockerItem)],
    [BLOCKER_LABELS.stalePrs, b.staleOpenPrNumbers.map(n => `#${n}`)],
  ]
  const present = groups.filter(([, items]) => items.length > 0)
  if (present.length === 0) return []
  const labelW = labelWidth(present.map(([label]) => ({ label, value: '' })))
  const room = reportWidth(opts) - (2 + labelW + 2)
  const fields: Field[] = present.map(([label, items]) => {
    const [first = '', ...rest] = items.map(i => truncate(i, room))
    return { label, value: first, more: rest }
  })
  return [
    ...sectionHeading('Blockers', opts),
    ...fieldLines(fields, 2, opts, labelW),
  ]
}

function blockerItem(i: SprintBlockerItem): string {
  return `${i.identifier} ${sanitizeField(i.title)}`
}

/**
 * LUM-1090 — `sprint show` as a detail view: `Label:  value` rows padded to
 * the widest label, a `Blockers` section with one blocker per line, the
 * LUM-1190 `Burnup` and `Team performance` sections, and the `Tasks (N)`
 * table. Plain text unless `opts` turns colour on.
 */
export function formatSprintShow(
  s: SprintShowData,
  progress: { done: number; total: number },
  tasks: TaskRow[],
  topBlockers?: SprintBlockers,
  opts: DetailOptions = {},
  metrics: SprintMetrics = {}
): string {
  // LUM-1232 D-1: `#<n>  <name>` first; the status coloured on a TTY (E-2).
  const titleLine = heading(`#${s.number}  ${sanitizeField(s.name)}`, {
    color: opts.color === true,
  })
  const header: Field[] = [
    { label: 'Status', value: enumColor(s.status, opts.color === true) },
    { label: 'Team', value: sanitizeField(s.team.name) },
    { label: 'Start', value: fmtCalendarDay(s.startDate) },
    { label: 'End', value: fmtCalendarDay(s.endDate) },
    { label: 'Started', value: fmtDay(s.startedAt) },
    { label: 'Closed', value: fmtDay(s.closedAt) },
  ]
  const progressRow: Field[] = [
    { label: 'Progress', value: `${progress.done}/${progress.total}` },
  ]
  // One label width across both groups, so the values share a column.
  const labelW = labelWidth([...header, ...progressRow])
  const lines = [
    titleLine,
    ...fieldLines(header, 0, opts, labelW),
    '',
    ...fieldLines(progressRow, 0, opts, labelW),
  ]
  if (topBlockers) lines.push(...blockerLines(topBlockers, opts))
  lines.push(...sprintBurnupLines(metrics.burnup, opts))
  lines.push(...sprintTeamPerformanceLines(metrics.teamPerformance, opts))
  lines.push(
    ...taskTableSection(tasks, 'None — no task is in this sprint.', opts)
  )
  return lines.join('\n')
}

export async function sprintShow(
  identifier: string,
  opts: ShowSprintOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let sprintId: string
  try {
    const resolved = await resolveSprintId(
      base,
      creds.token,
      identifier,
      opts.team,
      creds.workspaceSlug
    )
    sprintId = resolved.id
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // LUM-1190: the two secondary reads start now, in parallel with the main
  // ones. They are fail-soft — fetchSecondary never rejects, a failed or
  // malformed one renders `Could not read (…)` in its section — so one going
  // wrong cannot fail the whole show (and an early return below just drops them).
  const secondary = Promise.all([
    fetchSecondary(
      `${base}/api/sprints/${sprintId}/burnup`,
      creds.token,
      isSprintBurnupData
    ),
    fetchSecondary(
      `${base}/api/sprints/${sprintId}/team-performance`,
      creds.token,
      isSprintTeamPerformanceData
    ),
  ])

  // Fetch sprint details and tasks in parallel.
  let sprintRes: Response
  let tasksRes: Response
  try {
    ;[sprintRes, tasksRes] = await Promise.all([
      fetch(`${base}/api/sprints/${sprintId}`, {
        headers: { Authorization: `Bearer ${creds.token}` },
      }),
      fetch(`${base}/api/sprints/${sprintId}/tasks`, {
        headers: { Authorization: `Bearer ${creds.token}` },
      }),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (sprintRes.status === 401 || tasksRes.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!sprintRes.ok) {
    console.error(errHttp('sprint show', sprintRes.status))
    return 1
  }
  if (!tasksRes.ok) {
    console.error(errHttp('sprint tasks', tasksRes.status))
    return 1
  }

  const { sprint, progress, topBlockers } = (await sprintRes.json()) as {
    sprint: SprintShowData
    progress: { done: number; total: number }
    topBlockers?: SprintBlockers
  }
  const { tasks } = (await tasksRes.json()) as { tasks: TaskRow[] }

  const [burnup, teamPerformance] = await secondary

  process.stdout.write(
    formatSprintShow(
      sprint,
      progress,
      tasks,
      topBlockers,
      {
        width: terminalWidth(),
        color: colorEnabled(),
        tty: Boolean(process.stdout.isTTY),
      },
      { burnup, teamPerformance }
    ) + '\n'
  )
}

/**
 * GET a secondary payload. Never rejects: a network error, a non-2xx status,
 * an unparsable body or one that fails `isValid` all come back as a
 * {@link ReadFailure}.
 */
export async function fetchSecondary<T>(
  url: string,
  token: string,
  isValid: (body: unknown) => body is T
): Promise<T | ReadFailure> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const body: unknown = await res.json()
    return isValid(body) ? body : { error: 'unexpected response shape' }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
