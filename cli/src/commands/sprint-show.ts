import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { type TaskRow } from '../lib/format'
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
import { colorEnabled, terminalWidth, truncate } from '../lib/ui'

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

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '-'
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
 * the widest label, a `Blockers` section with one blocker per line, and the
 * `Tasks (N)` table. Plain text unless `opts` turns colour on.
 */
export function formatSprintShow(
  s: SprintShowData,
  progress: { done: number; total: number },
  tasks: TaskRow[],
  topBlockers?: SprintBlockers,
  opts: DetailOptions = {}
): string {
  const header: Field[] = [
    { label: 'Sprint', value: `#${s.number} ${sanitizeField(s.name)}` },
    { label: 'Status', value: s.status },
    { label: 'Team', value: sanitizeField(s.team.name) },
    { label: 'Start', value: fmtDate(s.startDate) },
    { label: 'End', value: fmtDate(s.endDate) },
    { label: 'Started', value: fmtDate(s.startedAt) },
    { label: 'Closed', value: fmtDate(s.closedAt) },
  ]
  const progressRow: Field[] = [
    { label: 'Progress', value: `${progress.done} / ${progress.total}` },
  ]
  // One label width across both groups, so the values share a column.
  const labelW = labelWidth([...header, ...progressRow])
  const lines = [
    ...fieldLines(header, 0, opts, labelW),
    '',
    ...fieldLines(progressRow, 0, opts, labelW),
  ]
  if (topBlockers) lines.push(...blockerLines(topBlockers, opts))
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

  process.stdout.write(
    formatSprintShow(sprint, progress, tasks, topBlockers, {
      width: terminalWidth(),
      color: colorEnabled(),
      tty: Boolean(process.stdout.isTTY),
    }) + '\n'
  )
}
