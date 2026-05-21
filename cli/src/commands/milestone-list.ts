import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

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

interface ProjectRow {
  id: string
  name: string
  isIdea?: boolean
}

interface ProjectsResponse {
  projects: ProjectRow[]
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
        `${r.status.padEnd(statusW)}  ${formatDate(r.targetDate).padEnd(dateW)}  ${r.name}`
    )
    .join('\n')
}

/**
 * Mirror of `lib/utils/slugify` — keep in sync with project-list.ts.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function milestoneList(
  options: MilestoneListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  // Resolve project: --project flag, or the only project in the workspace.
  let projectsRes: Response
  try {
    projectsRes = await fetch(`${base}/api/projects`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (projectsRes.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!projectsRes.ok) {
    console.error(`Error: could not list projects (HTTP ${projectsRes.status})`)
    return 1
  }

  const { projects } = (await projectsRes.json()) as ProjectsResponse
  const visible = projects.filter(p => !p.isIdea)

  let projectId: string | undefined
  if (options.project) {
    const ref = options.project.trim().toLowerCase()
    const match = visible.find(
      p => p.name.toLowerCase() === ref || slugify(p.name) === ref
    )
    if (!match) {
      console.error(
        `Error: project "${options.project}" not found. Try \`lumo project list\`.`
      )
      return 1
    }
    projectId = match.id
  } else if (visible.length === 1) {
    projectId = visible[0]!.id
  } else if (visible.length === 0) {
    console.error('Error: workspace has no projects yet.')
    return 1
  } else {
    console.error(
      'Error: workspace has multiple projects; pass --project <slug>.'
    )
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
