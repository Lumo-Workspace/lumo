import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { REF_ERROR_STATUSES, refLookupError } from '../lib/ref-error'
import { shortRef } from '../../../shared/src/short-ref'

export async function memoryPromote(
  memoryId: string | undefined
): Promise<number | void> {
  if (!memoryId) {
    console.error(
      'Error: missing <memory>. Usage: lumo memory promote <memory>'
    )
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
    res = await fetch(`${base}/api/memories/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scope: 'PROJECT' }),
    })
  } catch (err) {
    console.error(
      `Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`
    )
    return 1
  }
  if (res.status === 409) {
    // 409 is either "already project-scoped" or (LUM-1230) an ambiguous ref
    // whose message lists the candidates.
    const msg = await refLookupError(
      res,
      'this memory is already project-scoped.'
    )
    console.error(
      /ambiguous/i.test(msg)
        ? msg
        : 'Error: this memory is already project-scoped.'
    )
    return 1
  }
  if (REF_ERROR_STATUSES.has(res.status)) {
    // LUM-1230: the server resolves a short ref / unique prefix and explains
    // a miss or an ambiguous ref; the fallback covers an older server.
    console.error(
      await refLookupError(
        res,
        `memory ${sanitizeField(memoryId)} not found — pass the ref shown by \`lumo task memory list\` / \`lumo project memory list\``
      )
    )
    return 1
  }
  if (res.status !== 200) {
    let m: string | null = null
    try {
      const b = (await res.json()) as { error?: string }
      if (typeof b.error === 'string') m = b.error
    } catch {
      /* */
    }
    console.error(
      m ? `Error: ${sanitizeField(m)}` : errHttp('promote', res.status)
    )
    return 1
  }
  let promotedRef = sanitizeField(memoryId)
  try {
    const b = (await res.json()) as { memory?: { id?: unknown } }
    if (typeof b.memory?.id === 'string') promotedRef = shortRef(b.memory.id)
  } catch {
    /* keep what was typed */
  }
  process.stdout.write(
    `Promoted ${promotedRef} to PROJECT — every agent on this project now sees it.\n` +
      'Promote only lessons that recur across 2+ tasks.\n'
  )
}
