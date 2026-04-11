'use client'

import { useIntl } from 'react-intl'
import { AlignLeft, ChevronsLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TocItem } from '../DescriptionEditor'

interface DocumentTocProps {
  items: TocItem[]
  collapsed: boolean
  onToggle: () => void
  /** Container that owns the editor scroll. Used to scroll headings into view. */
  scrollRoot?: HTMLElement | null
}

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
          {items.map(item => (
            <li key={item.id}>
              <button
                type='button'
                onClick={() => handleClick(item.id)}
                style={{ paddingLeft: `${(item.level - 1) * 10 + 12}px` }}
                className={cn(
                  'block w-full text-left text-[12px] leading-[1.4] py-1 pr-2 truncate rounded-sm transition-colors',
                  item.isActive
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
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
          ))}
        </ul>
      )}
    </nav>
  )
}
