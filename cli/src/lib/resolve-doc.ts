export interface DocLike {
  id: string
  title: string
  /** LUM-1230: `<title>-<number>`; absent on an older server. */
  slug?: string | null
  /** Workspace-unique and stable across renames (the slug's tail). */
  number?: number | null
}

export type ResolveResult =
  | { kind: 'found'; doc: DocLike }
  | { kind: 'ambiguous'; candidates: DocLike[] }
  | { kind: 'not-found' }

/** A loose check — a real cuid is 'c' + 24 base36 chars. */
export function isLikelyCuid(s: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(s)
}

/**
 * Resolve a user-typed doc reference against a list. If the input looks
 * like a cuid, do exact-id match; otherwise match the slug (the web URL
 * segment, unique per workspace — LUM-1230), then the slug's `-<number>`
 * tail (stable across renames), then a case-insensitive title.
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
  // A renamed doc gets a new slug but keeps its number, so an old slug
  // (`old-title-12`) still finds doc #12.
  const tail = /-(\d+)$/.exec(lower)
  if (tail) {
    const n = Number(tail[1])
    const byNumber = docs.find(d => d.number === n)
    if (byNumber) return { kind: 'found', doc: byNumber }
  }
  const hits = docs.filter(d => d.title.toLowerCase() === lower)
  if (hits.length === 0) return { kind: 'not-found' }
  if (hits.length === 1) return { kind: 'found', doc: hits[0]! }
  return { kind: 'ambiguous', candidates: hits }
}
