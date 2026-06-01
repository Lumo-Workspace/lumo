import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { isLikelyCuid } from '../lib/resolve-doc'
import { lookupDocId } from '../lib/resolve-doc-id'
import { sanitizeField } from '../lib/sanitize'

export interface DeleteDocOptions {
  yes?: boolean
}

export async function docDelete(
  reference: string | undefined,
  opts: DeleteDocOptions
): Promise<number | void> {
  if (!reference) {
    console.error('Error: missing <doc>. Usage: lumo doc delete <doc> --yes')
    return 1
  }
  if (!opts.yes) {
    console.error('Error: Refusing to delete without --yes')
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  // For a cuid reference we don't have the title; for a title we look up id+title at once.
  let id: string
  let title = ''
  if (isLikelyCuid(reference)) {
    id = reference
  } else {
    const fetched = await lookupDocId(apiUrl, creds.token, reference)
    if (!fetched) {
      console.error(`Error: Document not found: ${reference}`)
      return 1
    }
    id = fetched
    // Pick up the title from the lookup payload by repeating the GET — small extra cost.
    // (Alternative: change lookupDocId to return the full DocLike. For now keep it simple.)
    title = reference
  }

  const res = await fetch(`${trimTrailingSlash(apiUrl)}/api/documents/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const escaped = sanitizeField(title).replace(/"/g, '\\"')
  console.log(`Deleted ${id}${title ? ` "${escaped}"` : ''}`)
}
