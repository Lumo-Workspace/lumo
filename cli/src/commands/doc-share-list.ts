import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { fetchMembers } from '../lib/resolve-member'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'

interface ShareListResponse {
  shares: Array<{
    id: string
    role: 'VIEWER' | 'EDITOR' | 'MANAGER'
    member: { id: string; clerkId: string }
  }>
}

export interface ShareListRow {
  displayName: string
  role: string
}

export function formatShareListRows(rows: ShareListRow[]): string[] {
  if (rows.length === 0) return []
  // Sanitize first, then measure/pad off the sanitized string so the
  // column width matches the printed cell (control chars stripped).
  const sanitized = rows.map(r => ({
    name: sanitizeField(r.displayName),
    role: r.role,
  }))
  const nameWidth = Math.max(...sanitized.map(r => r.name.length))
  return sanitized.map(r => `${r.name.padEnd(nameWidth, ' ')}  ${r.role}`)
}

export async function docShareList(
  docRef: string | undefined
): Promise<number | void> {
  if (!docRef) {
    console.error('Error: usage: lumo doc share-list <doc>')
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

  // Shares endpoint returns memberId only; we cross-reference the workspace
  // member directory to print a friendly display name. If the directory call
  // fails (rare), we fall back to memberId so the user still sees something.
  const [sharesRes, members] = await Promise.all([
    fetch(`${trimTrailingSlash(apiUrl)}/api/documents/${docId}/shares`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    }),
    fetchMembers(apiUrl, creds.token).catch(() => null),
  ])
  if (!sharesRes.ok) {
    const text = await sharesRes.text()
    console.error(errHttp('doc share list', sharesRes.status, text))
    return 1
  }
  const { shares } = (await sharesRes.json()) as ShareListResponse

  const nameByMemberId = new Map<string, string>()
  if (members) {
    for (const m of members) nameByMemberId.set(m.memberId, m.displayName)
  }

  const rows: ShareListRow[] = shares.map(s => ({
    displayName: nameByMemberId.get(s.member.id) ?? s.member.id,
    role: s.role,
  }))
  const lines = formatShareListRows(rows)
  for (const line of lines) console.log(line)
}
