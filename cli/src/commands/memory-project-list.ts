import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { formatMemoryList, type MemoryRowLike } from '../lib/memory-content'
import { resolveProjectId } from '../lib/resolve'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { resolveBoundProjectId } from '../lib/resolve-project'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { emitJson, listEnvelope, stripInternalFields } from '../lib/json-output'

interface ListOptions {
  category?: string
  limit?: string
  json?: boolean
}

export async function memoryProjectList(
  refArg: string | undefined,
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

  let projectId: string
  if (refArg) {
    projectId = await resolveProjectId(base, creds.token, refArg)
  } else {
    const bound = await resolveBoundTaskIdentifier(apiUrl, creds.token)
    if (!bound) {
      console.error(
        'Error: no <project-ref> given and no task bound to this session.\nPass a project, or run `lumo session attach <LUM-N>`.'
      )
      return EXIT_USAGE
    }
    const r = await resolveBoundProjectId(apiUrl, creds.token, bound)
    if (!r.ok) {
      console.error(`Error: ${r.error}`)
      return 1
    }
    projectId = r.id
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}/memories`,
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
