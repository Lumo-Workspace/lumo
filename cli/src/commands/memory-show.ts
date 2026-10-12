import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { reportPull } from '../lib/report-pull'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

interface Memory {
  id: string
  category: string
  content: unknown
}

/**
 * `lumo memory show <memory-id>`
 *
 * Progressive disclosure: fetch one memory's full card by id from
 * `/api/memories/:id`. The agent sees memories as one-line index entries at
 * session start; this pulls the body of a specific one on demand. Prints the
 * category tag and the structured content.
 */
export async function memoryShow(
  id: string | undefined
): Promise<number | void> {
  if (!id) {
    console.error('Error: usage: lumo memory show <memory-id>')
    return 1
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
  if (res.status === 404) {
    console.error(
      `Error: memory ${id} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('memory show', res.status))
    return 1
  }

  const { memory } = (await res.json()) as { memory: Memory }
  console.log(sanitizeField(`[${memory.category}]`))
  console.log(sanitizeField(JSON.stringify(memory.content, null, 2)))

  // LUM-500: stamp the disclosure funnel. The arg id == lineage MEMORY
  // fragmentId. Fire-and-forget — never blocks output, swallows failures.
  await reportPull({ fragmentType: 'MEMORY', fragmentId: id })
}
