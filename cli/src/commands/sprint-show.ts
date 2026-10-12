import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { formatTaskListTable, type TaskRow } from '../lib/format'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

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

function blockerLine(label: string, items: SprintBlockerItem[]): string | null {
  if (items.length === 0) return null
  const rendered = items
    .map(i => `${i.identifier} ${sanitizeField(i.title)}`)
    .join(', ')
  return `  ${label.padEnd(11)}${rendered}`
}

export function formatSprintShow(
  s: SprintShowData,
  progress: { done: number; total: number },
  tasks: TaskRow[],
  topBlockers?: SprintBlockers
): string {
  const lines = [
    `Sprint:    #${s.number} ${sanitizeField(s.name)}`,
    `Status:    ${s.status}`,
    `Team:      ${sanitizeField(s.team.name)}`,
    `Start:     ${fmtDate(s.startDate)}`,
    `End:       ${fmtDate(s.endDate)}`,
    `Started:   ${fmtDate(s.startedAt)}`,
    `Closed:    ${fmtDate(s.closedAt)}`,
    ``,
    `Progress:  ${progress.done} / ${progress.total}`,
  ]

  if (topBlockers) {
    const blockerLines = [
      blockerLine('Overdue:', topBlockers.overdueTaskIds),
      blockerLine('Stalled:', topBlockers.stalledTaskIds),
      blockerLine('Agent fail:', topBlockers.failingAgentTaskIds),
      topBlockers.staleOpenPrNumbers.length > 0
        ? `  ${'Stale PRs:'.padEnd(11)}${topBlockers.staleOpenPrNumbers
            .map(n => `#${n}`)
            .join(', ')}`
        : null,
    ].filter((l): l is string => l !== null)
    if (blockerLines.length > 0) {
      lines.push('Blockers:', ...blockerLines)
    }
  }

  if (tasks.length > 0) {
    lines.push('', formatTaskListTable(tasks))
  }
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
    formatSprintShow(sprint, progress, tasks, topBlockers) + '\n'
  )
}
