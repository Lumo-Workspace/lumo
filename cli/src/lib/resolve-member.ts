import { trimTrailingSlash } from './api'
import { httpFailed } from './errors'

export interface MemberRow {
  memberId: string
  displayName: string
  email: string | null
}

interface MembersResponse {
  members: Array<{
    id: string
    name: string
    email: string | null
  }>
}

/**
 * Fetch the workspace member directory once. Used by doc-share commands to
 * resolve a free-form member ref → memberId locally, because the document
 * shares endpoint expects WorkspaceMember.id (cuid) and does not do
 * server-side ref resolution the way /api/tasks does for assigneeRef.
 */
export async function fetchMembers(
  apiUrl: string,
  token: string
): Promise<MemberRow[]> {
  const url = `${trimTrailingSlash(apiUrl)}/api/workspaces/members`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(httpFailed('member list', res.status, text))
  }
  const body = (await res.json()) as MembersResponse
  return body.members.map(m => ({
    memberId: m.id,
    displayName: m.name,
    email: m.email,
  }))
}

export type ResolveResult =
  | { kind: 'ok'; member: MemberRow }
  | { kind: 'not_found'; query: string }
  | { kind: 'ambiguous'; query: string; candidates: MemberRow[] }

/**
 * Resolve `me`, an email, or a display name against the directory.
 * Match is case-insensitive. `me` resolves via the caller's stored email.
 * Email matches win over name matches so `alice@x.com` is unambiguous even
 * if a display name happens to collide.
 */
export function resolveMember(
  members: MemberRow[],
  ref: string,
  myEmail: string
): ResolveResult {
  const trimmed = ref.trim()
  if (trimmed.length === 0) return { kind: 'not_found', query: ref }

  if (trimmed.toLowerCase() === 'me') {
    const me = members.find(
      m => (m.email ?? '').toLowerCase() === myEmail.toLowerCase()
    )
    if (!me) return { kind: 'not_found', query: 'me' }
    return { kind: 'ok', member: me }
  }

  const lower = trimmed.toLowerCase()
  const byEmail = members.filter(m => (m.email ?? '').toLowerCase() === lower)
  if (byEmail.length === 1) return { kind: 'ok', member: byEmail[0]! }
  if (byEmail.length > 1) {
    return { kind: 'ambiguous', query: ref, candidates: byEmail }
  }
  const byName = members.filter(m => m.displayName.toLowerCase() === lower)
  if (byName.length === 1) return { kind: 'ok', member: byName[0]! }
  if (byName.length > 1) {
    return { kind: 'ambiguous', query: ref, candidates: byName }
  }
  return { kind: 'not_found', query: ref }
}
