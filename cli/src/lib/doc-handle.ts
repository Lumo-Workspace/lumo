/**
 * LUM-1230: how a document is named in CLI output — its slug
 * (`<title>-<number>`, the segment of the web URL and an accepted `<doc>`
 * ref), never the cuid. `lookupDocId` records the slug of every document it
 * resolves; {@link docHandle} reads it back, falling back to a slug carried
 * on a server response, and only then to the id (an older server).
 */
const slugById = new Map<string, string>()

export function rememberDocSlug(id: string, slug: string | null | undefined) {
  if (slug) slugById.set(id, slug)
}

export function docHandle(
  id: string,
  slug?: string | null | undefined
): string {
  if (slug) return slug
  return slugById.get(id) ?? id
}
