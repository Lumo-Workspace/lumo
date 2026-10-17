import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { fetchMembers, resolveMember } from '../lib/resolve-member'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { docHandle } from '../lib/doc-handle'

const ALLOWED_ROLES = ['VIEWER', 'EDITOR', 'MANAGER'] as const
type Role = (typeof ALLOWED_ROLES)[number]

export interface ShareOptions {
  role?: string
}

export function normalizeRole(value: string): Role | null {
  if (!value) return null
  const upper = value.toUpperCase()
  return (ALLOWED_ROLES as readonly string[]).includes(upper)
    ? (upper as Role)
    : null
}

export async function docShare(
  docRef: string | undefined,
  memberRef: string | undefined,
  opts: ShareOptions
): Promise<number | void> {
  if (!docRef || !memberRef) {
    console.error(
      'Error: usage: lumo doc share <doc> <member> [--role viewer|editor|manager]'
    )
    return EXIT_USAGE
  }

  let role: Role = 'VIEWER'
  if (opts.role !== undefined) {
    const normalized = normalizeRole(opts.role)
    if (!normalized) {
      console.error(
        `Error: invalid role "${opts.role}". Allowed: viewer, editor, manager`
      )
      return EXIT_USAGE
    }
    role = normalized
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

  const url = `${trimTrailingSlash(apiUrl)}/api/documents/${docId}/shares`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ memberId: result.member.memberId, role }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(errHttp('doc share', res.status, text))
    return 1
  }

  console.log(
    `Shared ${docHandle(docId)} ↔ ${sanitizeField(result.member.displayName)} (${role})`
  )
}
