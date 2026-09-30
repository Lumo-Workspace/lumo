'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { sanitizeRichHtmlInBrowser } from '@/lib/html/sanitize-rich-html.client'

/**
 * LUM-916 — the only way a client component renders stored rich-text HTML
 * (descriptions, comments, previews, revision diffs). The HTML is sanitized
 * against the shared allowlist first; see lib/html/rich-html-policy.ts.
 *
 * DOMPurify needs the browser DOM, so the server render and the hydration
 * pass emit an empty container and the content fills in right after mount.
 * A plain client render (the common case — these bodies arrive via React
 * Query) shows it immediately.
 */

const noopSubscribe = () => () => {}

export function RichHtml({
  html,
  className,
  'data-testid': testId,
}: {
  html: string | null | undefined
  className?: string | undefined
  'data-testid'?: string | undefined
}) {
  const inBrowser = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
  const safe = useMemo(
    () => (inBrowser ? sanitizeRichHtmlInBrowser(html) : ''),
    [inBrowser, html]
  )
  return (
    <div
      data-testid={testId}
      className={className}
      // Sanitized above against the shared rich-text allowlist.
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
