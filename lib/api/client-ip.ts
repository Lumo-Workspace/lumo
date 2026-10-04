/**
 * Best-effort client IP for per-IP throttling (LUM-983).
 *
 * On Vercel the platform sets `x-forwarded-for` (client first) and
 * `x-real-ip` itself and overwrites any client-supplied value, so the first
 * hop is trustworthy there. Off-platform (local dev, a self-hosted proxy
 * that appends rather than overwrites) both headers are client-controlled
 * and can be spoofed — use this only for abuse throttling, never for
 * authentication or audit truth. Requests carrying neither header share the
 * single `'unknown'` bucket.
 */
export function getClientIp(headers: Headers): string {
  const firstHop = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (firstHop) return firstHop
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  return 'unknown'
}
