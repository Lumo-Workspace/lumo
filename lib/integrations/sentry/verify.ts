import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies a Sentry Internal Integration webhook HMAC-SHA256 signature.
 *
 * Sentry sends the raw hex digest (no "sha256=" prefix) in the
 * `sentry-hook-signature` header.
 *
 * @param body            - Raw request body as a UTF-8 string
 * @param signatureHeader - Value of the sentry-hook-signature header (hex)
 * @param secret          - Client secret from the Sentry Internal Integration
 */
export function verifySentrySignature(
  body: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex')
  try {
    const a = Buffer.from(signatureHeader, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || a.length === 0) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
