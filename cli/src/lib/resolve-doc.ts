export interface DocLike {
  id: string
  title: string
  /** LUM-1230: `<title>-<number>`; absent on an older server. */
  slug?: string | null
  /** Workspace-unique and stable across renames (the slug's tail). */
  number?: number | null
}

export type ResolveResult =
  /** `viaNumber`: matched only by an old slug's `-<number>` tail. */
  | { kind: 'found'; doc: DocLike; viaNumber?: true }
  | { kind: 'ambiguous'; candidates: DocLike[] }
  | { kind: 'not-found' }

/** A loose check — a real cuid is 'c' + 24 base36 chars. */
export function isLikelyCuid(s: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(s)
}

/**
 * Resolve a user-typed doc reference against a list. If the input looks
 * like a cuid, do exact-id match; otherwise match the slug (the web URL
 * segment, unique per workspace — LUM-1230), then a case-insensitive title,
 * then — for slug-shaped input only — the slug's `-<number>` tail, which
 * survives a rename.
 * Multiple title hits return 'ambiguous'.
 */
export function resolveDoc(input: string, docs: DocLike[]): ResolveResult {
  const trimmed = input.trim()
  if (isLikelyCuid(trimmed)) {
    const doc = docs.find(d => d.id === trimmed)
    return doc ? { kind: 'found', doc } : { kind: 'not-found' }
  }
  const lower = trimmed.toLowerCase()
  const bySlug = docs.find(
    d => d.slug != null && d.slug.toLowerCase() === lower
  )
  if (bySlug) return { kind: 'found', doc: bySlug }
  const hits = docs.filter(d => d.title.toLowerCase() === lower)
  if (hits.length === 0) {
    // Last resort: a renamed doc gets a new slug but keeps its number, so an
    // old slug (`old-title-12`) still finds doc #12. Only slug-shaped input
    // (lowercase words joined by `-`) qualifies, and only after no title
    // matched — a title like "Release-2" never lands on doc #2.
    // The caller tells the user when this fallback picked the doc.
    const tail = /^[a-z0-9]+(?:-[a-z0-9]+)*-(\d+)$/.exec(lower)
    const byNumber = tail
      ? docs.find(d => d.number === Number(tail[1]))
      : undefined
    return byNumber
      ? { kind: 'found', doc: byNumber, viaNumber: true }
      : { kind: 'not-found' }
  }
  if (hits.length === 1) return { kind: 'found', doc: hits[0]! }
  return { kind: 'ambiguous', candidates: hits }
}
