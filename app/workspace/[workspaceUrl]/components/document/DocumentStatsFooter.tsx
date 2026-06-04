'use client'

import { useIntl } from 'react-intl'
import type { EditorStats } from '@/lib/editor/reading-stats'

interface DocumentStatsFooterProps {
  stats: EditorStats | null
}

/**
 * Footer line under the document editor showing word count, character count,
 * and estimated reading time. Reading time is omitted for empty documents
 * (where it would read as "0 min"). Counts come from {@link useEditorStats}.
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
    <div className='mt-6 pt-3 border-t border-border text-xs text-muted-foreground'>
      {parts.join(' · ')}
    </div>
  )
}
