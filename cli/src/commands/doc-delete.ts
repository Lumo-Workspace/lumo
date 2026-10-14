import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { errHttp, errNotLoggedIn } from '../lib/errors'

export type DeleteDocOptions = ConfirmFlags

/** Where a trashed document can be restored or erased (LUM-918). */
export const DOC_TRASH_HINT = 'restorable for 30 days from Settings → Trash'

/** The changes[] block for the confirmation envelope. */
export function describeDocDelete(id: string, title: string): string[] {
  const escaped = sanitizeField(title).replace(/"/g, '\\"')
  return [
    `Will move document ${id} "${escaped}" to the trash — ${DOC_TRASH_HINT}, then permanently deleted`,
    'Every document nested under it goes to the trash with it and comes back on restore; while trashed they are hidden from lists, the doc tree and task context',
    'To erase it at once instead (e.g. a GDPR erasure request), delete it permanently from Settings → Trash afterwards',
  ]
}

export async function docDelete(
  reference: string | undefined,
  opts: DeleteDocOptions
): Promise<number | void> {
  if (!reference) {
    console.error(
      'Error: missing <doc>. Usage: lumo doc delete <doc> --confirm'
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
  const headers = { Authorization: `Bearer ${creds.token}` }

  const id = await lookupDocId(apiUrl, creds.token, reference)
  if (!id) {
    console.error(`Error: Document not found: ${reference}`)
    return 1
  }

  // Always fetch the doc first: the envelope needs its real title, and the
  // same GET confirms it exists before anything destructive happens.
  const showRes = await fetch(`${base}/api/documents/${id}`, { headers })
  if (!showRes.ok) {
    const text = await showRes.text()
    console.error(errHttp('doc lookup', showRes.status, text))
    return 1
  }
  const { document } = (await showRes.json()) as {
    document: { id: string; title: string }
  }
  const title = document.title ?? ''

  // LUM-755: no --confirm → envelope, no DELETE.
  if (!isConfirmed(opts)) {
    return emitConfirmation({
      command: 'doc delete',
      changes: describeDocDelete(id, title),
    })
  }

  const res = await fetch(`${base}/api/documents/${id}`, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(errHttp('doc delete', res.status, text))
    return 1
  }
  const escaped = sanitizeField(title).replace(/"/g, '\\"')
  process.stdout.write(
    `Moved ${id}${title ? ` "${escaped}"` : ''} to the trash (${DOC_TRASH_HINT})\n`
  )
}
