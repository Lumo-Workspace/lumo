import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { reportPull } from '../lib/report-pull'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { REF_ERROR_STATUSES, refLookupError } from '../lib/ref-error'
import { shortRef } from '../../../shared/src/short-ref'

interface Memory {
  id: string
  category: string
  content: unknown
}

/**
 * `lumo memory show <memory>`
 *
 * Progressive disclosure: fetch one memory's full card from
 * `/api/memories/:ref`. LUM-1230: `<memory>` is the 8-char short ref listings
 * print, a unique id prefix, or the full cuid — the server resolves it inside
 * the caller's workspace and refuses an ambiguous one with the candidates. The agent sees memories as one-line index entries at
 * session start; this pulls the body of a specific one on demand. Prints the
 * category tag and the structured content.
 */
export async function memoryShow(
  id: string | undefined
): Promise<number | void> {
  if (!id) {
    console.error('Error: usage: lumo memory show <memory>')
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(`${base}/api/memories/${encodeURIComponent(id)}`, {
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
  if (REF_ERROR_STATUSES.has(res.status)) {
    console.error(
      await refLookupError(
        res,
        `memory ${sanitizeField(id)} not found in workspace ${creds.workspaceSlug}`
      )
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('memory show', res.status))
    return 1
  }

  const { memory } = (await res.json()) as { memory: Memory }
  console.log(sanitizeField(`[${memory.category}] ${shortRef(memory.id)}`))
  console.log(sanitizeField(JSON.stringify(memory.content, null, 2)))

  // LUM-500: stamp the disclosure funnel with the lineage MEMORY fragmentId —
  // the resolved full id, not the (possibly short) ref typed (LUM-1230).
  // Fire-and-forget — never blocks output, swallows failures.
  await reportPull({ fragmentType: 'MEMORY', fragmentId: memory.id })
}
