import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveSprintId } from '../lib/resolve'
import { formatTaskListTable, type TaskRow } from '../lib/format'
import { sanitizeField } from '../lib/sanitize'

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

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '-'
}

export function formatSprintShow(
  s: SprintShowData,
  progress: { done: number; total: number },
  tasks: TaskRow[]
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
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!sprintRes.ok) {
    console.error(`Error: sprint show failed (HTTP ${sprintRes.status})`)
    return 1
  }
  if (!tasksRes.ok) {
    console.error(`Error: sprint tasks failed (HTTP ${tasksRes.status})`)
    return 1
  }

  const { sprint, progress } = (await sprintRes.json()) as {
    sprint: SprintShowData
    progress: { done: number; total: number }
  }
  const { tasks } = (await tasksRes.json()) as { tasks: TaskRow[] }

  process.stdout.write(formatSprintShow(sprint, progress, tasks) + '\n')
}
