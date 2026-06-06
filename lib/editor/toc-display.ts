import type { TocItem } from '@/app/workspace/[workspaceUrl]/hooks/useTocSync'

/**
 * Sentinel id for the synthetic document-title root node prepended to the
 * outline. Clicking an item with this id scrolls the document to the very top
 * rather than querying a `data-toc-id` heading (the title is not a heading).
 */
export const TOC_ROOT_ID = '__toc_doc_title__'

/**
 * Prepend the document title as a root node so the outline has a top-level
 * anchor, the way Feishu/Notion show the title atop the outline.
 *
 * The title lives in a separate `<input>`, not the editor body, so the Tiptap
 * TableOfContents extension never emits it. We inject it here in the display
 * layer instead of teaching the extension about it.
 *
 * Returns `items` unchanged (same reference) when the title is blank. The root
 * is level 1 — body headings start at H2, so it sits one indent step above
 * them. It is never `isActive`: it is not a real heading the scroll resolver
 * can mark, and a title doesn't need a reading-position highlight.
 */
export function withTitleRoot(items: TocItem[], title: string): TocItem[] {
  const trimmed = title.trim()
  if (!trimmed) return items
  const root: TocItem = {
    id: TOC_ROOT_ID,
    level: 1,
    textContent: trimmed,
    isActive: false,
    itemIndex: -1,
  }
  return [root, ...items]
}

export type TocLevelTier = 'root' | 'section' | 'sub'

/**
 * Map a heading level to a visual tier so the outline conveys hierarchy through
 * type (size/weight), not only indentation. Level 1 (title root / H1) → root,
 * H2 → section, H3 and deeper → sub.
 */
export function tocLevelTier(level: number): TocLevelTier {
  if (level <= 1) return 'root'
  if (level === 2) return 'section'
  return 'sub'
}
