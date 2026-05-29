import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { formatMemoryList, type MemoryRowLike } from '../lib/memory-content'
import { resolveProjectId } from '../lib/resolve'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { resolveBoundProjectId } from '../lib/resolve-project'

interface ListOptions { category?: string; limit?: string }

export async function memoryProjectList(
  refArg: string | undefined,
  options: ListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  if (refArg) {
    projectId = await resolveProjectId(base, creds.token, refArg)
  } else {
    const bound = await resolveBoundTaskIdentifier(apiUrl, creds.token)
    if (!bound) { console.error('Error: no <project-ref> given and no task bound to this session.\nPass a project, or run `lumo session attach <LUM-N>`.'); return 1 }
    const r = await resolveBoundProjectId(apiUrl, creds.token, bound)
    if (!r.ok) { console.error(`Error: ${r.error}`); return 1 }
    projectId = r.id
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/memories`, { headers: { Authorization: `Bearer ${creds.token}` } })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (!res.ok) { console.error(`Error: memory list failed (HTTP ${res.status})`); return 1 }

  let rows = ((await res.json()) as { memories: MemoryRowLike[] }).memories
  if (options.category) rows = rows.filter(m => m.category.toLowerCase() === options.category!.toLowerCase())
  const limit = options.limit ? parseInt(options.limit, 10) : undefined
  if (limit && limit > 0) rows = rows.slice(0, limit)
  process.stdout.write(formatMemoryList(rows) + '\n')
}
