import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'

type MilestoneHealth = 'on-track' | 'at-risk' | 'overdue'

interface MilestoneRow {
  id: string
  name: string
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  targetDate: string | null
  createdAt: string
  archivedAt: string | null
  /** Target-date health light. Server-enriched; null when no light applies. */
  health?: MilestoneHealth | null
}

interface MilestonesResponse {
  milestones: MilestoneRow[]
}

const HEALTH_LABEL: Record<MilestoneHealth, string> = {
  'on-track': 'ON-TRACK',
  'at-risk': 'AT-RISK',
  overdue: 'OVERDUE',
}

function formatHealth(health: MilestoneHealth | null | undefined): string {
  return health ? HEALTH_LABEL[health] : '-'
}

export interface MilestoneListOptions {
  project?: string | undefined
  archived?: boolean | undefined
  all?: boolean | undefined
  search?: string | undefined
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return iso.slice(0, 10)
}

/**
 * Render milestones as fixed-width rows:
 *   <STATUS>  <HEALTH>  <target-date or ->  <name>
 *
 * HEALTH is the target-date risk light (ON-TRACK / AT-RISK / OVERDUE), or `-`
 * when no light applies (terminal status or no target date).
 *
 * Sorted server-side by targetDate asc nulls last, createdAt asc.
 */
export function formatMilestoneList(rows: MilestoneRow[]): string {
  if (rows.length === 0) return 'No milestones.'
  const statusW = Math.max(...rows.map(r => r.status.length))
  const healthW = Math.max(...rows.map(r => formatHealth(r.health).length))
  const dateW = Math.max(...rows.map(r => formatDate(r.targetDate).length))
  return rows
    .map(
      r =>
        `${r.status.padEnd(statusW)}  ${formatHealth(r.health).padEnd(healthW)}  ${formatDate(r.targetDate).padEnd(dateW)}  ${r.archivedAt ? `${sanitizeField(r.name)} (archived)` : sanitizeField(r.name)}`
    )
    .join('\n')
}

export async function milestoneList(
  options: MilestoneListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  try {
    projectId = await resolveProjectId(base, creds.token, options.project)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    return 1
  }

  if (options.archived && options.all) {
    console.error('Error: --archived and --all are mutually exclusive.')
    return 1
  }
  const filter = options.all ? 'all' : options.archived ? 'archived' : 'active'

  const query = new URLSearchParams({ filter })
  const term = options.search?.trim()
  if (term) query.set('search', term)

  const res = await fetch(
    `${base}/api/projects/${projectId}/milestones?${query.toString()}`,
    { headers: { Authorization: `Bearer ${creds.token}` } }
  )
  if (!res.ok) {
    console.error(`Error: milestone list failed (HTTP ${res.status})`)
    return 1
  }
  const data = (await res.json()) as MilestonesResponse
  process.stdout.write(formatMilestoneList(data.milestones) + '\n')
}
