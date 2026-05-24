import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveTeamId } from '../lib/resolve'

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

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return iso.slice(0, 10)
}

/**
 * Render sprints as fixed-width rows (server already sorts by number desc):
 *   <STATUS>  #<number>  <start>..<end>  <name>
 */
export function formatSprintList(rows: SprintRow[]): string {
  if (rows.length === 0) return 'No sprints.'

  const statusW = Math.max(...rows.map(r => r.status.length))
  const numW = Math.max(...rows.map(r => String(r.number).length))

  return rows
    .map(r => {
      const statusCol = r.status.padEnd(statusW)
      const numCol = `#${r.number}`.padEnd(numW + 1) // +1 for the '#'
      const dateRange = `${formatDate(r.startDate)}..${formatDate(r.endDate)}`
      return `${statusCol}  ${numCol}  ${dateRange}  ${r.name}`
    })
    .join('\n')
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

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
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
  if (options.limit) params.set('limit', options.limit)

  const query = params.toString()
  const url = `${base}/api/teams/${teamId}/sprints${query ? `?${query}` : ''}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!res.ok) {
    console.error(`Error: sprint list failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as SprintsResponse
  process.stdout.write(formatSprintList(data.sprints) + '\n')
}
