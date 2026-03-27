import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies a GitHub webhook HMAC-SHA256 signature.
 *
 * @param body            - Raw request body as a string
 * @param signatureHeader - Value of the x-hub-signature-256 header
 * @param secret          - The webhook secret registered with GitHub
 */
export function verifyGitHubSignature(
  body: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false
  const expected =
    'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  try {
    // timingSafeEqual requires same-length buffers
    const a = Buffer.from(signatureHeader)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
