import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'

export type DeleteDocOptions = ConfirmFlags

/** The changes[] block for the confirmation envelope. */
export function describeDocDelete(id: string, title: string): string[] {
  const escaped = sanitizeField(title).replace(/"/g, '\\"')
  return [
    `Will delete document ${id} "${escaped}"`,
    'Every document nested under it is deleted with it; task bindings and shares are dropped',
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
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error(
      `Error: ${showRes.status} ${showRes.statusText}: ${sanitizeField(text)}`
    )
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
    console.error(
      `Error: ${res.status} ${res.statusText}: ${sanitizeField(text)}`
    )
    return 1
  }
  const escaped = sanitizeField(title).replace(/"/g, '\\"')
  console.log(`Deleted ${id}${title ? ` "${escaped}"` : ''}`)
}
