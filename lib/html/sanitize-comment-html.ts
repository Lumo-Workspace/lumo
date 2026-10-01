import {
  HEADER_MARKER_CLOSE,
  HEADER_MARKER_OPEN,
} from '@/lib/integrations/github/markdown-bridge'
import { sanitizeRichHtml } from './sanitize-rich-html'

/**
 * LUM-921 — write-time sanitizer for comment bodies (task comments incl.
 * send-backs, document comments, mirrored PR comments). Same allowlist as
 * every render path (`rich-html-policy.ts`), so a stored body can no longer
 * carry `<img onerror>` / `<script>` / `javascript:` into a sink that forgot
 * to sanitize.
 *
 * sanitize-html drops HTML comments, but mirrored PR comments keep a
 * `<!-- pr-mirror-header -->` block the mirror and review-todo builder read
 * back. Split on those exact markers, sanitize each piece, rejoin: every piece
 * comes out well-formed with no raw `<` in text, so the joined result is as
 * safe as one sanitized string.
 */
const MARKER_SPLIT = new RegExp(
  `(${HEADER_MARKER_OPEN}|${HEADER_MARKER_CLOSE})`
)

export function sanitizeCommentHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .split(MARKER_SPLIT)
    .map(part =>
      part === HEADER_MARKER_OPEN || part === HEADER_MARKER_CLOSE
        ? part
        : sanitizeRichHtml(part)
    )
    .join('')
}
