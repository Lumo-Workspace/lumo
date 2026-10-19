'use client'

import { useIntl } from 'react-intl'
import type { EditorStats } from '@/lib/editor/reading-stats'

interface DocumentStatsFooterProps {
  stats: EditorStats | null
}

/**
 * Word count, character count, and estimated reading time for the document
 * editor, rendered as a low-key floating pill pinned to the bottom-right of
 * the editor pane (à la Google Docs / Feishu) so it stays visible while
 * writing instead of scrolling out of view at the end of the content. Reading
 * time is omitted for empty documents (where it would read as "0 min"). Counts
 * come from {@link useEditorStats}.
 *
 * Layout: the outer wrapper is a zero-height `sticky bottom-0` layer so it
 * reserves no flow space and never pushes content; it must be rendered as a
 * direct child of the editor's scroll container. `pointer-events-none` on the
 * wrapper keeps the empty strip click-through; the pill re-enables pointer
 * events for its own (text-selectable) content.
 */
export function DocumentStatsFooter({ stats }: DocumentStatsFooterProps) {
  const intl = useIntl()
  if (!stats) return null

  const parts = [
    intl.formatMessage(
      { id: 'documentEditor.stats.words' },
      { count: stats.words }
    ),
    intl.formatMessage(
      { id: 'documentEditor.stats.characters' },
      { count: stats.characters }
    ),
  ]
  if (stats.readingMinutes > 0) {
    parts.push(
      intl.formatMessage(
        { id: 'documentEditor.stats.readingTime' },
        { minutes: stats.readingMinutes }
      )
    )
  }

  return (
    <div className='sticky bottom-0 z-sticky h-0 pointer-events-none'>
      <div className='absolute bottom-4 right-4 pointer-events-auto select-none rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur'>
        {parts.join(' · ')}
      </div>
    </div>
  )
}
