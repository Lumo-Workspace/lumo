import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'

interface MilestoneRow {
  id: string
  name: string
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  targetDate: string | null
  createdAt: string
}

interface MilestonesResponse {
  milestones: MilestoneRow[]
}

export interface MilestoneListOptions {
  project?: string | undefined
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return iso.slice(0, 10)
}

/**
 * Render milestones as fixed-width rows:
 *   <STATUS>  <target-date or ->  <name>
 *
 * Sorted server-side by targetDate asc nulls last, createdAt asc.
 */
export function formatMilestoneList(rows: MilestoneRow[]): string {
  if (rows.length === 0) return 'No milestones.'
  const statusW = Math.max(...rows.map(r => r.status.length))
  const dateW = Math.max(...rows.map(r => formatDate(r.targetDate).length))
  return rows
    .map(
      r =>
        `${r.status.padEnd(statusW)}  ${formatDate(r.targetDate).padEnd(dateW)}  ${sanitizeField(r.name)}`
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

  const res = await fetch(`${base}/api/projects/${projectId}/milestones`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    console.error(`Error: milestone list failed (HTTP ${res.status})`)
    return 1
  }
  const data = (await res.json()) as MilestonesResponse
  process.stdout.write(formatMilestoneList(data.milestones) + '\n')
}
