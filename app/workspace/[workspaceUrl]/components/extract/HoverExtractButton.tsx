'use client'
import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  extractTasks,
  ExtractTasksError,
} from '@/lib/api-client/documents-extract'

export interface HoverExtractButtonProps {
  documentId: string
  /** Returns the current HTML with the target node tagged data-extract-pending=true. */
  prepareContent: () => string
  /** Called after a successful extract with the new full content. */
  onApplied: (newContent: string) => void
  /** Called on error to surface a toast. */
  onError: (err: ExtractTasksError | Error) => void
}

export function HoverExtractButton({
  documentId,
  prepareContent,
  onApplied,
  onError,
}: HoverExtractButtonProps) {
  const intl = useIntl()
  const [pending, setPending] = useState(false)
  const label = intl.formatMessage({ id: 'doc.extract.button.hover' })

  async function go() {
    setPending(true)
    try {
      const res = await extractTasks(documentId, {
        content: prepareContent(),
        selector: { type: 'marked' },
      })
      onApplied(res.updatedContent)
    } catch (err) {
      onError(err as Error)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type='button'
      onClick={go}
      disabled={pending}
      className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100'
      aria-label={label}
    >
      → task
    </button>
  )
}
