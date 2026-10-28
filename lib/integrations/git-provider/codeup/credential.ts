/**
 * LUM-1316 — the opaque strings the Codeup adapter hands the scan and gets
 * back unchanged.
 *
 * - The "repository token" the scan passes to every comment / read call is
 *   the organization id plus the connection's personal access token: a
 *   Codeup (center edition) call needs both, and the port's comment calls
 *   carry only the token. It is a secret like any token — never logged.
 * - A comment id is the merge request's local id plus Codeup's
 *   `comment_biz_id`: updating or deleting a comment needs both, and the
 *   port's update / delete calls carry only the id.
 *
 * PURE.
 */
import {
  CodeupApiError,
  isValidOrganizationId,
} from '@/lib/integrations/codeup/client'

const CREDENTIAL_PREFIX = 'codeup:'

export interface CodeupCredential {
  organizationId: string
  token: string
}

export function encodeCodeupCredential(c: CodeupCredential): string {
  return `${CREDENTIAL_PREFIX}${c.organizationId}:${c.token}`
}

/** Throws 401 for anything this module did not produce. */
export function decodeCodeupCredential(handle: string): CodeupCredential {
  if (handle.startsWith(CREDENTIAL_PREFIX)) {
    const rest = handle.slice(CREDENTIAL_PREFIX.length)
    const at = rest.indexOf(':')
    // An organization id never holds ':' (isValidOrganizationId), so the
    // first one ends it; the token keeps whatever follows.
    const organizationId = at > 0 ? rest.slice(0, at) : ''
    const token = at > 0 ? rest.slice(at + 1) : ''
    if (isValidOrganizationId(organizationId) && token.length > 0)
      return { organizationId, token }
  }
  throw new CodeupApiError(401, 'Not a Codeup credential')
}

export function encodeCommentId(localId: number, commentBizId: string): string {
  return `${localId}:${commentBizId}`
}

/** Throws 404 for an id this module did not produce (no such comment). */
export function decodeCommentId(externalId: string): {
  localId: number
  commentBizId: string
} {
  const at = externalId.indexOf(':')
  const localId = Number(externalId.slice(0, at))
  const commentBizId = externalId.slice(at + 1)
  if (at < 1 || !Number.isSafeInteger(localId) || localId < 1 || !commentBizId)
    throw new CodeupApiError(404, 'Not a Codeup comment id')
  return { localId, commentBizId }
}
