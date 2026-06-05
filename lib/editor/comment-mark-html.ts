// lib/editor/comment-mark-html.ts
import { parse } from 'node-html-parser'
import type { HTMLElement } from 'node-html-parser'

const COMMENT_SPAN_SELECTOR = 'span[data-comment-id]'

/** Unwrap ALL comment spans (keep inner content), return serialized HTML. */
export function stripCommentSpans(html: string): string {
  if (!html) return ''
  const root = parse(html)
  let spans = root.querySelectorAll(COMMENT_SPAN_SELECTOR)
  while (spans.length > 0) {
    for (const span of spans) {
      span.replaceWith(span.innerHTML)
    }
    spans = root.querySelectorAll(COMMENT_SPAN_SELECTOR)
  }
  return root.toString()
}

/** Unwrap only the comment span(s) carrying the given comment id. */
export function removeCommentSpan(html: string, commentId: string): string {
  if (!html) return ''
  const root = parse(html)
  const spans = root
    .querySelectorAll(COMMENT_SPAN_SELECTOR)
    .filter((s: HTMLElement) => s.getAttribute('data-comment-id') === commentId)
  for (const span of spans) {
    span.replaceWith(span.innerHTML)
  }
  return root.toString()
}

/** Distinct comment ids present in the html. */
export function extractCommentIds(html: string): string[] {
  if (!html) return []
  const root = parse(html)
  const ids = new Set<string>()
  for (const span of root.querySelectorAll(COMMENT_SPAN_SELECTOR)) {
    const id = span.getAttribute('data-comment-id')
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * Anti-tampering guard for the privileged content-patch: after stripping every
 * comment span from both versions, the HTML must be byte-identical. Allows
 * adding/removing comment marks while rejecting ANY other content change.
 * Throws Error with status 400 on mismatch.
 */
export function assertOnlyCommentMarksChanged(
  oldHtml: string,
  newHtml: string
): void {
  const a = stripCommentSpans(oldHtml)
  const b = stripCommentSpans(newHtml)
  if (a !== b) {
    throw Object.assign(
      new Error(
        'Content change rejected: only comment mark additions and removals are permitted'
      ),
      { status: 400 }
    )
  }
}
