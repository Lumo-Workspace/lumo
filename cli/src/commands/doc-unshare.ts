import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { fetchMembers, resolveMember } from '../lib/resolve-member'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { docHandle } from '../lib/doc-handle'

interface ShareListResponse {
  shares: Array<{
    id: string
    member: { id: string }
  }>
}

export async function docUnshare(
  docRef: string | undefined,
  memberRef: string | undefined
): Promise<number | void> {
  if (!docRef || !memberRef) {
    console.error('Error: usage: lumo doc unshare <doc> <member>')
    return EXIT_USAGE
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

  let members
  try {
    members = await fetchMembers(apiUrl, creds.token)
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    return 1
  }
  const result = resolveMember(members, memberRef, creds.email)
  if (result.kind === 'not_found') {
    console.error(`Error: no member matches "${result.query}".`)
    return 1
  }
  if (result.kind === 'ambiguous') {
    const list = result.candidates
      .map(c => sanitizeField(c.email ?? c.displayName))
      .join(', ')
    console.error(`Error: multiple members match "${result.query}": ${list}`)
    return 1
  }

  // The DELETE endpoint takes a share-row id, not a memberId. Fetch the
  // current shares to find the row for this member.
  const sharesUrl = `${trimTrailingSlash(apiUrl)}/api/documents/${docId}/shares`
  const listRes = await fetch(sharesUrl, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!listRes.ok) {
    const text = await listRes.text()
    console.error(errHttp('doc share list', listRes.status, text))
    return 1
  }
  const { shares } = (await listRes.json()) as ShareListResponse
  const row = shares.find(s => s.member.id === result.member.memberId)
  if (!row) {
    console.log(`Not shared with ${sanitizeField(result.member.displayName)}`)
    return
  }

  const delUrl = `${trimTrailingSlash(apiUrl)}/api/documents/${docId}/shares/${row.id}`
  const delRes = await fetch(delUrl, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!delRes.ok) {
    const text = await delRes.text()
    console.error(errHttp('doc unshare', delRes.status, text))
    return 1
  }
  console.log(
    `Unshared ${docHandle(docId)} ↔ ${sanitizeField(result.member.displayName)}`
  )
}
