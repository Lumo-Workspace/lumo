import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'

export async function memoryPromote(
  memoryId: string | undefined
): Promise<number | void> {
  if (!memoryId) {
    console.error(
      'Error: missing <memoryId>. Usage: lumo memory promote <memoryId>'
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
  if (res.status === 404) {
    console.error(
      `Error: memory ${memoryId} not found — pass the full memory id (cuid) from \`lumo task memory list\` / \`lumo project memory list\`; truncated id prefixes are not resolved`
    )
    return 1
  }
  if (res.status === 409) {
    console.error('Error: this memory is already project-scoped.')
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
  process.stdout.write(
    `Promoted ${memoryId} to PROJECT — every agent on this project now sees it.\n` +
      'Promote only lessons that recur across 2+ tasks.\n'
  )
}
