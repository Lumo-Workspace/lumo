import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'

export async function docUnbind(
  docRef: string | undefined,
  task: string | undefined
): Promise<number | void> {
  if (!docRef || !task) {
    console.error('Error: usage: lumo doc unbind <doc> <task>')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  const docId = await lookupDocId(apiUrl, creds.token, docRef)
  if (!docId) {
    console.error(`Error: Document not found: ${docRef}`)
    return 1
  }

  // The DELETE route accepts either cuid or LUM-N as the [taskId] segment; the server resolves it.
  const url = `${trimTrailingSlash(apiUrl)}/api/documents/${docId}/mentions/${encodeURIComponent(task)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 409) {
    const { error } = (await res.json()) as { error: string }
    console.error(`Error: ${sanitizeField(error)}`)
    return 1
  }
  if (!res.ok) {
    const text = await res.text()
    console.error(errHttp('doc unbind', res.status, text))
    return 1
  }
  const data = (await res.json()) as { removed: number; taskIdentifier: string }
  if (data.removed === 0) {
    console.log(`Already unbound ${docId} ↔ ${data.taskIdentifier}`)
  } else {
    console.log(`Unbound ${docId} ↔ ${data.taskIdentifier}`)
  }
}
