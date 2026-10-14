import { emptyState, fmtCalendarDay } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveTeamId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

export interface SprintRow {
  id: string
  number: number
  name: string
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
  startDate: string | null
  endDate: string | null
}

interface SprintsResponse {
  sprints: SprintRow[]
}

export interface SprintListOptions {
  team?: string | undefined
  status?: string | undefined
  limit?: string | undefined
}

const VALID_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const

/**
 * Render sprints as a table (server already sorts by number desc; LUM-1089
 * header on a TTY only):
 *   <STATUS>  #<number>  <start>..<end>  <name>
 */
export function formatSprintList(
  rows: SprintRow[],
  opts: ListRenderOptions = {}
): string {
  if (rows.length === 0) return emptyState('sprints')
  return renderListTable(
    rows.map(r => [
      r.status,
      `#${r.number}`,
      `${fmtCalendarDay(r.startDate)}..${fmtCalendarDay(r.endDate)}`,
      sanitizeField(r.name),
    ]),
    { header: ['STATUS', 'SPRINT', 'DATES', 'NAME'], flex: 3, ...opts }
  )
}

export async function sprintList(
  options: SprintListOptions
): Promise<number | void> {
  // Validate --status if provided
  let normalizedStatus: string | undefined
  if (options.status !== undefined) {
    normalizedStatus = options.status.toUpperCase()
    if (!(VALID_STATUSES as readonly string[]).includes(normalizedStatus)) {
      console.error(
        `Error: invalid --status "${options.status}". Valid values: draft | active | closed`
      )
      return 1
    }
  }

  const limit =
    options.limit !== undefined ? parseInt(options.limit, 10) : undefined
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    console.error(
      `Error: invalid --limit "${options.limit}" (expected a positive integer)`
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let teamId: string
  try {
    const team = await resolveTeamId(base, creds.token, options.team)
    teamId = team.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    return 1
  }

  const params = new URLSearchParams()
  if (normalizedStatus) params.set('status', normalizedStatus)
  if (limit !== undefined) params.set('limit', String(limit))

  const query = params.toString()
  const url = `${base}/api/teams/${teamId}/sprints${query ? `?${query}` : ''}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('sprint list', res.status))
    return 1
  }

  const data = (await res.json()) as SprintsResponse
  process.stdout.write(formatSprintList(data.sprints) + '\n')
}
