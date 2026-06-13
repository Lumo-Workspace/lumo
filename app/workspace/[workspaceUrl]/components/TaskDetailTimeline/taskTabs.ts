export type TabValue =
  | 'comments'
  | 'activity'
  | 'context'
  | 'agent'
  | 'memory'
  | 'lineage'

/**
 * URL path segment for each tab. Comments is the default tab and carries no
 * segment (the bare task URL, e.g. /my-tasks/LUM-1), so its slug is the empty
 * string. The rest append a segment (e.g. /my-tasks/LUM-1/delivery).
 */
export const TAB_SLUGS: Record<TabValue, string> = {
  comments: '',
  activity: 'activity',
  context: 'context',
  agent: 'delivery',
  memory: 'memory',
  lineage: 'lineage',
}

const SLUG_TO_TAB: Record<string, TabValue> = Object.fromEntries(
  (Object.entries(TAB_SLUGS) as [TabValue, string][])
    .filter(([, slug]) => slug !== '')
    .map(([tab, slug]) => [slug, tab])
)

/**
 * Resolve a URL path segment to a tab.
 * - no segment → the default Comments tab
 * - a known non-default slug → that tab
 * - anything else (unknown slug, or the literal "comments" whose canonical URL
 *   is the bare address) → null, so the caller can fall back + normalize.
 */
export function tabFromSlug(slug: string | undefined): TabValue | null {
  if (!slug) return 'comments'
  return SLUG_TO_TAB[slug] ?? null
}
