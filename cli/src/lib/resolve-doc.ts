export interface DocLike {
  id: string
  title: string
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
 * like a cuid, do exact-id match; otherwise do case-insensitive title
 * match. Multiple title hits return 'ambiguous'.
 */
export function resolveDoc(input: string, docs: DocLike[]): ResolveResult {
  const trimmed = input.trim()
  if (isLikelyCuid(trimmed)) {
    const doc = docs.find(d => d.id === trimmed)
    return doc ? { kind: 'found', doc } : { kind: 'not-found' }
  }
  const lower = trimmed.toLowerCase()
  const hits = docs.filter(d => d.title.toLowerCase() === lower)
  if (hits.length === 0) return { kind: 'not-found' }
  if (hits.length === 1) return { kind: 'found', doc: hits[0]! }
  return { kind: 'ambiguous', candidates: hits }
}
