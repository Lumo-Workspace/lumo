import { emptyState, fmtCalendarDay } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import {
  buildCommand,
  pageFooter,
  paginate,
  parsePageArgs,
} from '../lib/pagination'
import {
  formatHealth,
  milestoneState,
  type MilestoneHealth,
} from '../lib/milestone-labels'

interface MilestoneRow {
  id: string
  name: string
  /** LUM-714: derived completion stamp; non-null = the milestone is done. */
  completedAt: string | null
  targetDate: string | null
  createdAt: string
  archivedAt: string | null
  /** Target-date health light. Server-enriched; null when no light applies. */
  health?: MilestoneHealth | null
}

interface MilestonesResponse {
  milestones: MilestoneRow[]
}

export interface MilestoneListOptions {
  project?: string | undefined
  archived?: boolean | undefined
  all?: boolean | undefined
  search?: string | undefined
  limit?: string | undefined
  cursor?: string | undefined
}

/**
 * Render milestones as a table (LUM-1089, header on a TTY only):
 *   <STATE>  <HEALTH>  <target-date or ->  <name>
 *
 * STATE is ACTIVE / COMPLETED / ARCHIVED (LUM-714) — derived, never stored.
 * HEALTH is the target-date risk light (ON-TRACK / AT-RISK / OVERDUE), or `-`
 * when no light applies (completed, archived, or no target date).
 *
 * Sorted server-side by targetDate asc nulls last, createdAt asc.
 */
export function formatMilestoneList(
  rows: MilestoneRow[],
  opts: ListRenderOptions = {}
): string {
  if (rows.length === 0) return emptyState('milestones')
  return renderListTable(
    rows.map(r => [
      milestoneState(r),
      formatHealth(r.health),
      fmtCalendarDay(r.targetDate),
      sanitizeField(r.name),
    ]),
    { header: ['STATE', 'HEALTH', 'TARGET', 'NAME'], flex: 3, ...opts }
  )
}

export async function milestoneList(
  options: MilestoneListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
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
  const pageArgs = parsePageArgs(options.limit, options.cursor)
  if (!pageArgs.ok) {
    console.error(`Error: ${pageArgs.error}`)
    return 1
  }

  const query = new URLSearchParams({ filter })
  const term = options.search?.trim()
  if (term) query.set('search', term)

  const res = await fetch(
    `${base}/api/projects/${projectId}/milestones?${query.toString()}`,
    { headers: { Authorization: `Bearer ${creds.token}` } }
  )
  if (!res.ok) {
    console.error(errHttp('milestone list', res.status))
    return 1
  }
  const data = (await res.json()) as MilestonesResponse
  // LUM-1093: the route returns the project's whole (filtered) list, so the
  // page is cut here.
  const page = paginate(data.milestones, pageArgs)
  const lines = [
    page.items.length === 0 && page.total > 0
      ? 'No milestones on this page.'
      : formatMilestoneList(page.items),
    ...pageFooter(
      { ...page, shown: page.items.length },
      buildCommand('milestone list', [
        ['--project', options.project],
        ['--archived', options.archived],
        ['--all', options.all],
        ['--search', options.search],
        ['--limit', options.limit],
      ])
    ),
  ]
  process.stdout.write(lines.join('\n') + '\n')
}
