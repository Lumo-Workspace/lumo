export type TabValue = 'comments' | 'activity' | 'context' | 'dossier'

/**
 * The four named, deep-linkable regions live *inside* the dossier (LUM-567).
 * ④ "evidence & causality" splits into three independently-expandable
 * sub-sections; the legacy Delivery / Lineage / Memory top-level tab slugs now
 * resolve to one of these instead of being their own tab, preserving the
 * LUM-458 deep-link contract (a shared URL jumps to — and expands — its region).
 */
export type DossierSection = 'runs' | 'lineage' | 'memory'

/**
 * URL path segment for each tab. Comments is the default tab and carries no
 * segment (the bare task URL, e.g. /my-tasks/LUM-1), so its slug is the empty
 * string. The rest append a segment (e.g. /my-tasks/LUM-1/record).
 *
 * The dossier tab's segment is `record` — matching its English label — while the
 * internal `TabValue` key stays `dossier` (the 任务档案 concept). Slug ≠ key is
 * the existing convention here (the old Delivery tab keyed `agent` → slug
 * `delivery`). There is no `dossier` slug — it was never shipped to users.
 */
export const TAB_SLUGS: Record<TabValue, string> = {
  comments: '',
  activity: 'activity',
  context: 'context',
  dossier: 'record',
}

const SLUG_TO_TAB: Record<string, TabValue> = Object.fromEntries(
  (Object.entries(TAB_SLUGS) as [TabValue, string][])
    .filter(([, slug]) => slug !== '')
    .map(([tab, slug]) => [slug, tab])
)

/**
 * Legacy top-level slugs (the Delivery / Lineage / Memory tabs that LUM-567
 * folded into the dossier). They no longer name a tab — each deep-links into a
 * dossier ④ sub-section, so an old shared URL still lands on the right content.
 */
const LEGACY_SECTION_SLUG: Record<string, DossierSection> = {
  delivery: 'runs',
  lineage: 'lineage',
  memory: 'memory',
}

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

export interface ResolvedTab {
  tab: TabValue
  /** A dossier ④ sub-section to expand + scroll to (legacy deep link), else null. */
  section: DossierSection | null
}

/**
 * Resolve a URL path segment to a tab *and* an optional dossier section.
 * Superset of {@link tabFromSlug}: it additionally maps the legacy
 * Delivery / Lineage / Memory slugs onto the dossier tab with the section to
 * expand. Returns null for an unknown slug so the caller normalizes the URL.
 */
export function resolveTab(slug: string | undefined): ResolvedTab | null {
  if (!slug) return { tab: 'comments', section: null }
  const direct = SLUG_TO_TAB[slug]
  if (direct) return { tab: direct, section: null }
  const section = LEGACY_SECTION_SLUG[slug]
  if (section) return { tab: 'dossier', section }
  return null
}

/**
 * DOM id of the boundary-crossings panel inside the Record tab. The verdict
 * bar's DONE-blocked "Review the crossings below" link (LUM-454) targets it as
 * a URL hash; the panel scrolls itself into view on mount when the hash names
 * it, because the link is clicked from ABOVE the tabs and the panel may not be
 * mounted yet (it only renders inside the Record tab).
 */
export const BOUNDARY_CROSSINGS_ANCHOR = 'boundary-crossings'

const TAB_SEGMENTS = new Set<string>([
  ...Object.values(TAB_SLUGS).filter(slug => slug !== ''),
  ...Object.keys(LEGACY_SECTION_SLUG),
])

/**
 * The bare task URL (no tab segment) for the current pathname: strips a
 * trailing tab / legacy-section segment if present. Mirrors the basePath
 * derivation in TimelineTabs for callers that only have `usePathname()`.
 */
export function taskBasePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  if (cut < 0) return trimmed
  return TAB_SEGMENTS.has(trimmed.slice(cut + 1))
    ? trimmed.slice(0, cut)
    : trimmed
}

/** Deep link into the Record tab, landing on the boundary-crossings panel. */
export function boundaryCrossingsHref(pathname: string): string {
  return `${taskBasePath(pathname)}/${TAB_SLUGS.dossier}#${BOUNDARY_CROSSINGS_ANCHOR}`
}
