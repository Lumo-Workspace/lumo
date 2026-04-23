import {
  authService,
  type VerifyApiKeyResult,
} from '@/lib/services/auth.service'

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
 */
export async function verifyBearer(
  request: Request
): Promise<VerifyApiKeyResult | null> {
  const header = request.headers.get('Authorization')
  if (!header) return null
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null
  return authService.verifyApiKey(token)
}
