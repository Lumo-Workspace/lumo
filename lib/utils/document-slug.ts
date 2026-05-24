const FALLBACK_BASE = 'untitled'

/**
 * Build the slug prefix from a document title. Replaces every run of
 * non-alphanumeric characters with a single `-`, matching the PostgreSQL
 * backfill in migration `20260523135446_add_document_number_slug` so
 * service-time and backfill slugs stay byte-identical (e.g. "v1.0" → "v1-0",
 * not "v10"). Falls back to "untitled" when the title has no ASCII
 * alphanumerics (e.g. all-CJK or empty titles).
 */
export function buildDocumentSlugBase(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base.length > 0 ? base : FALLBACK_BASE
}

/**
 * Compose the storage form of a document slug: `${slugify(title)}-${number}`.
 * Because `number` is unique per workspace by construction, this slug is also
 * guaranteed unique per workspace without any collision loop.
 */
export function buildDocumentSlug(title: string, number: number): string {
  return `${buildDocumentSlugBase(title)}-${number}`
}

/**
 * Parse a URL segment into its trailing numeric component. Returns the number
 * if the segment ends in `-<digits>`, or null otherwise (e.g. a raw cuid like
 * "cmpib7orx001h04jov9tlyy5x" has no numeric tail and yields null).
 */
export function parseDocumentSlugNumber(segment: string): number | null {
  const match = segment.match(/-(\d+)$/)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}
