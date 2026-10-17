import { sanitizeField } from './sanitize'

/** HTTP statuses a server-side ref lookup answers with (LUM-1230). */
export const REF_ERROR_STATUSES = new Set([400, 404, 409])

/**
 * LUM-1230: the one-line error for a failed ref lookup. The server explains a
 * too-short ref (400), no match (404) and an ambiguous one (409, listing every
 * candidate) in its `error` field; that text is printed as is (sanitized).
 * `fallback` covers an older server or a body without a message.
 */
export async function refLookupError(
  res: Response,
  fallback: string
): Promise<string> {
  let message: string | null = null
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim() !== '') {
      message = body.error
    }
  } catch {
    /* not JSON — use the fallback */
  }
  // A bare "Not found" / "Memory not found" from an older server says less
  // than the caller's fallback.
  if (message === null || /^(\w+ )?not found$/i.test(message.trim())) {
    return `Error: ${fallback}`
  }
  return `Error: ${sanitizeField(message)}`
}
