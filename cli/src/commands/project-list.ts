import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { slugify } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

interface ProjectRow {
  id: string
  name: string
  isIdea?: boolean
}

interface ProjectsResponse {
  projects: ProjectRow[]
}

/**
 * Render projects as `slug-style-name  Display Name` lines. The slug form
 * matches what `lumo task create --project <ref>` accepts (slugify(name)),
 * so users can copy a slug straight into the create flag.
 *
 * Slug source of truth: `cli/src/lib/resolve.ts` (mirrors server's
 * `lib/utils/slugify.ts`). Keep that single copy in sync with the server.
 */
export function formatProjectList(projects: ProjectRow[]): string {
  if (projects.length === 0) return 'No projects.'
  const rows = projects
    .filter(p => !p.isIdea)
    .map(p => ({ slug: slugify(p.name), name: p.name }))
  if (rows.length === 0) return 'No projects.'
  const w = Math.max(...rows.map(r => r.slug.length))
  return rows
    .map(r => `${r.slug.padEnd(w)}  ${sanitizeField(r.name)}`)
    .join('\n')
}

export async function projectList(): Promise<number | void> {
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
  process.stdout.write(formatProjectList(data.projects) + '\n')
}
