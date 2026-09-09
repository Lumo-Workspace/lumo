import {
  authService,
  type VerifyApiKeyResult,
} from '@/lib/services/auth.service'

export interface VerifyBearerOptions {
  /** Scopes this route accepts in addition to full (unscoped) keys. Default: none. */
  allowScopes?: readonly string[]
}

/**
 * Parse an `Authorization: Bearer <token>` header from a request and verify
 * the token via authService.
 *
 * Returns the resolved identity if the token is valid, or `null` if the
 * header is missing, malformed, or the key is unknown/revoked. Throws if
 * the underlying verification fails (e.g. DB or Clerk unavailable) so the
 * caller can decide between 401 and 500.
 *
 * The scheme token (`Bearer`) is matched case-insensitively per RFC 7235.
 *
 * LUM-735: a scoped key (e.g. the CI ingest key living in a repo secret) is
 * refused by default. Routes that accept a given scope must opt in via
 * `opts.allowScopes`; unscoped (full) keys always pass.
 */
export async function verifyBearer(
  request: Request,
  opts: VerifyBearerOptions = {}
): Promise<VerifyApiKeyResult | null> {
  const header = request.headers.get('Authorization')
  if (!header) return null
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null
  const result = await authService.verifyApiKey(token)
  if (!result) return null
  const scope = result.apiKey.scope ?? null
  if (scope !== null && !(opts.allowScopes ?? []).includes(scope)) return null
  return result
}
