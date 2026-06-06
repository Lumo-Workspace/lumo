'use client'

import { useMemo } from 'react'
import { diffDocumentText, htmlToPlainText } from '@/lib/editor/revision-diff'

export type DiffMode = 'inline' | 'split'

interface RevisionDiffViewProps {
  oldHtml: string | null
  newHtml: string | null
  mode: DiffMode
}

export function RevisionDiffView({
  oldHtml,
  newHtml,
  mode,
}: RevisionDiffViewProps) {
  const segments = useMemo(
    () => diffDocumentText(htmlToPlainText(oldHtml), htmlToPlainText(newHtml)),
    [oldHtml, newHtml]
  )

  if (mode === 'split') {
    return (
      <div className='grid grid-cols-2 gap-4 text-sm'>
        <div
          data-testid='diff-old-pane'
          className='prose prose-sm min-w-0 max-w-none break-words rounded-md border border-border p-3'
          dangerouslySetInnerHTML={{ __html: oldHtml ?? '' }}
        />
        <div
          data-testid='diff-new-pane'
          className='prose prose-sm min-w-0 max-w-none break-words rounded-md border border-border p-3'
          dangerouslySetInnerHTML={{ __html: newHtml ?? '' }}
        />
      </div>
    )
  }

  return (
    <div
      data-testid='diff-inline'
      className='whitespace-pre-wrap break-words text-sm leading-relaxed'
    >
      {segments.map((seg, i) => {
        if (seg.added) {
          return (
            <span
              key={i}
              data-diff='added'
              className='bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
            >
              {seg.value}
            </span>
          )
        }
        if (seg.removed) {
          return (
            <span
              key={i}
              data-diff='removed'
              className='bg-red-100 text-red-800 line-through dark:bg-red-950 dark:text-red-300'
            >
              {seg.value}
            </span>
          )
        }
        return <span key={i}>{seg.value}</span>
      })}
    </div>
  )
}
