'use client'

import { useMemo } from 'react'
import { diffDocumentHtml } from '@/lib/editor/revision-diff'
import { RichHtml } from '@/components/RichHtml'

interface RevisionDiffViewProps {
  oldHtml: string | null
  newHtml: string | null
}

// ins/del marks are injected via dangerouslySetInnerHTML, so they are styled
// with arbitrary variants instead of per-element classes. Same green/red
// palette the inline diff used before, minus the browser default underline.
const DIFF_MARK_CLASSES =
  '[&_ins]:rounded-sm [&_ins]:bg-green-100 [&_ins]:px-0.5 [&_ins]:text-green-800 [&_ins]:no-underline ' +
  'dark:[&_ins]:bg-green-950 dark:[&_ins]:text-green-300 ' +
  '[&_del]:rounded-sm [&_del]:bg-red-100 [&_del]:px-0.5 [&_del]:text-red-800 [&_del]:line-through ' +
  'dark:[&_del]:bg-red-950 dark:[&_del]:text-red-300'

export function RevisionDiffView({ oldHtml, newHtml }: RevisionDiffViewProps) {
  const html = useMemo(
    () => diffDocumentHtml(oldHtml, newHtml),
    [oldHtml, newHtml]
  )

  return (
    <RichHtml
      data-testid='diff-inline'
      className={`prose prose-sm max-w-none break-words text-body ${DIFF_MARK_CLASSES}`}
      html={html}
    />
  )
}
