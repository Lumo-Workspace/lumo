import { emptyState } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { slugify } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { emitJson, listEnvelope, stripInternalFields } from '../lib/json-output'

interface ProjectRow {
  id: string
  name: string
  isIdea?: boolean
  /** LUM-1285; absent on an older server (then read as ACTIVE). */
  status?: string
  archivedAt?: string | null
}

export interface ProjectListOptions {
  json?: boolean
  /** LUM-1285: include archived projects (hidden by default). */
  all?: boolean
}

/**
 * The projects `project list` shows: never idea drafts; archived ones only
 * with `--all` (LUM-1285).
 */
export function listedProjects<T extends ProjectRow>(
  projects: T[],
  opts: { all?: boolean | undefined } = {}
): T[] {
  return projects.filter(p => !p.isIdea && (opts.all || !p.archivedAt))
}

/** `ACTIVE`, `PAUSED`, … plus `· archived` when archived (LUM-1285). */
export function projectStateLabel(p: ProjectRow): string {
  const status = p.status ?? 'ACTIVE'
  return p.archivedAt ? `${status} · archived` : status
}

interface ProjectsResponse {
  projects: ProjectRow[]
}

/**
 * Render projects as a `SLUG  NAME` table (LUM-1089 shape, header on a TTY
 * only). The slug form matches what `lumo task create --project <ref>`
 * accepts (slugify(name)), so users can copy a slug straight into the flag.
 *
 * Slug source of truth: `cli/src/lib/resolve.ts` (mirrors server's
 * `lib/utils/slugify.ts`). Keep that single copy in sync with the server.
 */
export function formatProjectList(
  projects: ProjectRow[],
  opts: ListRenderOptions & { all?: boolean | undefined } = {}
): string {
  const { all, ...renderOpts } = opts
  const rows = listedProjects(projects, { all }).map(p => [
    sanitizeField(slugify(p.name)),
    sanitizeField(p.name),
    projectStateLabel(p),
  ])
  if (rows.length === 0) return emptyState('projects')
  return renderListTable(rows, {
    header: ['SLUG', 'NAME', 'STATUS'],
    flex: 1,
    ...renderOpts,
  })
}

/**
 * The `--json` envelope: the same projects the table lists (idea projects
 * left out, archived ones unless `--all`), each with the `slug` the table prints — the ref
 * `--project <ref>` accepts.
 */
export function projectListJson(
  projects: ProjectRow[],
  opts: { all?: boolean | undefined } = {}
): Record<string, unknown> {
  return listEnvelope(
    'projects',
    listedProjects(projects, opts).map(p =>
      stripInternalFields({ ...p, slug: slugify(p.name) })
    )
  )
}

export async function projectList(
  opts: ProjectListOptions = {}
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/projects`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('project list', res.status))
    return 1
  }

  const data = (await res.json()) as ProjectsResponse
  if (opts.json) {
    emitJson(projectListJson(data.projects, { all: opts.all }))
    return
  }
  process.stdout.write(
    formatProjectList(data.projects, { all: opts.all }) + '\n'
  )
}
