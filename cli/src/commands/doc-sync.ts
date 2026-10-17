import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { docHandle } from '../lib/doc-handle'

interface SyncedDocResponse {
  document: { id: string; slug?: string | null; title: string }
}

export function formatSyncedLine(doc: {
  id: string
  slug?: string | null
  title: string
}): string {
  const escaped = sanitizeField(doc.title).replace(/"/g, '\\"')
  return `Synced ${docHandle(doc.id, doc.slug)} "${escaped}" from Google`
}

export async function docSync(reference: string): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  const docId = await lookupDocId(apiUrl, creds.token, reference)
  if (!docId) {
    console.error(`Error: doc not found: ${reference}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/documents/${docId}/sync-google`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }
  if (!res.ok) {
    const text = await res.text()
    console.error(errHttp('doc sync', res.status, text))
    return 1
  }

  const { document } = (await res.json()) as SyncedDocResponse
  console.log(formatSyncedLine(document))
}
