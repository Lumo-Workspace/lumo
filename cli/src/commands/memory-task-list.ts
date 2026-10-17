import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { formatMemoryList, type MemoryRowLike } from '../lib/memory-content'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { emitJson, listEnvelope, stripInternalFields } from '../lib/json-output'

interface ListOptions {
  category?: string
  limit?: string
  json?: boolean
}

export async function memoryTaskList(
  identifierArg: string | undefined,
  options: ListOptions
): Promise<number | void> {
  const limit =
    options.limit !== undefined ? parseInt(options.limit, 10) : undefined
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    console.error(
      `Error: invalid --limit "${options.limit}" (expected a positive integer)`
    )
    return EXIT_USAGE
  }
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  const identifier =
    identifierArg ?? (await resolveBoundTaskIdentifier(apiUrl, creds.token))
  if (!identifier) {
    console.error(
      'Error: no <LUM-N> given and no task bound to this session.\nPass it explicitly or run `lumo session attach <LUM-N>`.'
    )
    return EXIT_USAGE
  }

  let taskId: string
  try {
    const r = await fetch(
      `${base}/api/tasks/resolve/${encodeURIComponent(identifier)}`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
    if (r.status === 404) {
      console.error(
        `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
      )
      return 1
    }
    if (!r.ok) {
      console.error(errHttp('resolve', r.status))
      return 1
    }
    taskId = ((await r.json()) as { id: string }).id
  } catch (err) {
    console.error(
      `Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`
    )
    return 1
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/memories`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    console.error(
      `Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('memory list', res.status))
    return 1
  }

  let rows = ((await res.json()) as { memories: MemoryRowLike[] }).memories
  if (options.category)
    rows = rows.filter(
      m => m.category.toLowerCase() === options.category!.toLowerCase()
    )
  // `total` counts the filtered list before `--limit` cuts it.
  const total = rows.length
  if (limit !== undefined) rows = rows.slice(0, limit)
  if (options.json) {
    emitJson(listEnvelope('memories', stripInternalFields(rows), { total }))
    return
  }
  process.stdout.write(formatMemoryList(rows) + '\n')
}
