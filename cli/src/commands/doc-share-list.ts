import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { fetchMembers } from '../lib/resolve-member'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'

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

/** LUM-1089 table shape: `NAME  ROLE` (header on a TTY only). */
export function formatShareListRows(
  rows: ShareListRow[],
  opts: ListRenderOptions = {}
): string[] {
  if (rows.length === 0) return []
  // Sanitize before the table measures the cells (control chars stripped).
  return renderListTable(
    rows.map(r => [sanitizeField(r.displayName), r.role]),
    { header: ['NAME', 'ROLE'], flex: 0, ...opts }
  ).split('\n')
}

export async function docShareList(
  docRef: string | undefined
): Promise<number | void> {
  if (!docRef) {
    console.error('Error: usage: lumo doc share-list <doc>')
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
