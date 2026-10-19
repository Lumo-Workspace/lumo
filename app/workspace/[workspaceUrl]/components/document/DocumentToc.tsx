'use client'

import { useIntl } from 'react-intl'
import { AlignLeft, ChevronsLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TOC_ROOT_ID,
  tocLevelTier,
  type TocLevelTier,
} from '@/lib/editor/toc-display'
import type { TocItem } from '../DescriptionEditorLazy'

interface DocumentTocProps {
  items: TocItem[]
  collapsed: boolean
  onToggle: () => void
  /** Container that owns the editor scroll. Used to scroll headings into view. */
  scrollRoot?: HTMLElement | null
}

/**
 * Per-tier typography so the outline conveys hierarchy through size + weight,
 * not indentation alone. The size tier is always applied; colour only when the
 * item is inactive, and the active branch upgrades the weight (TIER_ACTIVE).
 */
const TIER_SIZE: Record<TocLevelTier, string> = {
  root: 'text-body-strong',
  section: 'text-body',
  sub: 'text-caption font-normal',
}
const TIER_REST: Record<TocLevelTier, string> = {
  root: 'text-foreground',
  section: 'text-foreground',
  sub: 'text-muted-foreground',
}
// Active emphasis per tier: the strong variant of the tier's own size, so the
// active item never changes size (only weight).
const TIER_ACTIVE: Record<TocLevelTier, string> = {
  root: 'text-body-strong',
  section: 'text-body-strong',
  sub: 'font-semibold',
}

// Active = reading-position highlight. Monochrome on purpose (brand --primary is
// near-black, and hierarchy here is carried by type, not colour): a left bar +
// semibold + a solid accent background, distinct from the plain accent hover.
const TOC_ACTIVE =
  'text-foreground bg-accent ' +
  'before:absolute before:left-0 before:top-1 before:bottom-1 ' +
  'before:w-[2.5px] before:rounded-full before:bg-foreground'

/**
 * Document table of contents sidebar.
 *
 * Renders the heading list emitted by the Tiptap TableOfContents extension.
 * Clicking an item scrolls the corresponding heading into view by querying
 * the `data-toc-id` attribute the extension stamps onto each heading.
 *
 * When `collapsed` is true, only a single icon button is shown so the user
 * can re-open the panel without losing horizontal real estate.
 */
export function DocumentToc({
  items,
  collapsed,
  onToggle,
  scrollRoot,
}: DocumentTocProps) {
  const intl = useIntl()

  const handleClick = (id: string) => {
    // The synthetic title root isn't a heading — scroll to the very top instead
    // of querying a non-existent data-toc-id.
    if (id === TOC_ROOT_ID) {
      const scroller = scrollRoot ?? window
      scroller.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const root = scrollRoot ?? document
    const target = root.querySelector(`[data-toc-id="${id}"]`)
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <nav>
      <button
        type='button'
        onClick={onToggle}
        title={intl.formatMessage(
          collapsed
            ? {
                id: 'documentToc.expand',
                defaultMessage: 'Show table of contents',
              }
            : {
                id: 'documentToc.collapse',
                defaultMessage: 'Hide table of contents',
              }
        )}
        className='flex items-center justify-center size-8 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
      >
        {collapsed ? (
          <AlignLeft className='size-4' />
        ) : (
          <ChevronsLeft className='size-4' />
        )}
      </button>
      {!collapsed && (
        <ul className='mt-2 space-y-px'>
          {items.map(item => {
            const tier = tocLevelTier(item.level)
            return (
              <li key={item.id}>
                <button
                  type='button'
                  onClick={() => handleClick(item.id)}
                  style={{ paddingLeft: `${(item.level - 1) * 12 + 10}px` }}
                  className={cn(
                    'relative block w-full text-left py-1 pr-2 truncate rounded-sm transition-colors',
                    TIER_SIZE[tier],
                    item.isActive
                      ? cn(TOC_ACTIVE, TIER_ACTIVE[tier])
                      : cn(
                          TIER_REST[tier],
                          'hover:text-foreground hover:bg-accent'
                        )
                  )}
                  title={item.textContent}
                >
                  {item.textContent || (
                    <span className='italic opacity-60'>
                      {intl.formatMessage({
                        id: 'documentToc.untitledHeading',
                        defaultMessage: 'Untitled heading',
                      })}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}
