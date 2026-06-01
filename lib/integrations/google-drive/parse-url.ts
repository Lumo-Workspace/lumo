// Google file ids are URL-safe base64-ish: letters, digits, _ and -.
const ID_RE = /^[A-Za-z0-9_-]{10,}$/

export function parseGoogleDocId(input: string): string | null {
  const trimmed = input.trim()
  if (ID_RE.test(trimmed)) return trimmed
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null
  // /document/d/<id>/edit  or  /file/d/<id>/...
  const pathMatch = url.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/)
  if (pathMatch) return pathMatch[1]
  // open?id=<id>
  const idParam = url.searchParams.get('id')
  if (idParam && ID_RE.test(idParam)) return idParam
  return null
}
