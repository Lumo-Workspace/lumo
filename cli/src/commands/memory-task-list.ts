import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { formatMemoryList, type MemoryRowLike } from '../lib/memory-content'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'

interface ListOptions {
  category?: string
  limit?: string
}

export async function memoryTaskList(
  identifierArg: string | undefined,
  options: ListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  const identifier = identifierArg ?? (await resolveBoundTaskIdentifier(apiUrl, creds.token))
  if (!identifier) {
    console.error('Error: no <LUM-N> given and no task bound to this session.\nPass it explicitly or run `lumo session attach <LUM-N>`.')
    return 1
  }

  let taskId: string
  try {
    const r = await fetch(`${base}/api/tasks/resolve/${encodeURIComponent(identifier)}`, { headers: { Authorization: `Bearer ${creds.token}` } })
    if (r.status === 404) { console.error(`Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`); return 1 }
    if (!r.ok) { console.error(`Error: resolve failed (HTTP ${r.status})`); return 1 }
    taskId = ((await r.json()) as { id: string }).id
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/tasks/${encodeURIComponent(taskId)}/memories`, { headers: { Authorization: `Bearer ${creds.token}` } })
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
