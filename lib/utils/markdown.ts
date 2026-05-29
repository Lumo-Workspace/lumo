import { marked } from 'marked'
import { isHtml } from './html-to-markdown'

// `htmlToMarkdown` (turndown-based) lives in its own module so server callers
// like the doc service can depend on it without pulling in marked.
export { htmlToMarkdown, isHtml } from './html-to-markdown'

/**
 * Detect whether a string is likely Markdown (as opposed to HTML).
 * Looks for common markdown patterns: headings, lists, code fences, links, bold/italic.
 */
export function isMarkdown(text: string): boolean {
  return /(?:^#{1,6}\s|^[-*+]\s|^```|^\d+\.\s|\[.*?\]\(.*?\)|\*\*.+?\*\*|__.+?__)/m.test(
    text
  )
}

/**
 * Convert Markdown text to HTML.
 * If the input is already HTML, returns it as-is to avoid double-conversion.
 */
export function markdownToHtml(md: string): string {
  if (isHtml(md)) return md
  return marked.parse(md, { async: false }) as string
}

/**
 * Stricter HTML detection used only for the rich-text-write path.
 * Matches strings that *begin* with a block tag (Tiptap output, pasted
 * HTML), so a markdown body that merely mentions a tag inline (e.g.
 * "wrapped in `<p>`") is NOT mistaken for HTML.
 *
 * Kept private to this module — the existing `isHtml` is more permissive
 * and is intentionally left untouched for the document path.
 */
function looksLikeHtmlDocument(text: string): boolean {
  return /^\s*<(p|div|h[1-6]|ul|ol|pre|blockquote|table|img)\b[^>]*>/i.test(
    text
  )
}

/**
 * Normalize a rich-text field for storage in a Tiptap-backed column.
 *
 * - null / undefined / blank input → null (unifies "clear" semantics).
 * - Input that looks like a structural HTML document → returned as-is.
 * - Anything else → markdown → HTML via `marked.parse`, **bypassing**
 *   `markdownToHtml`'s `isHtml` short-circuit. `looksLikeHtmlDocument` above
 *   already decided this isn't HTML; `markdownToHtml` re-checks with the
 *   permissive `isHtml` regex and would short-circuit on bodies that merely
 *   mention `<p>`/`<h2>` inline (e.g. LUM-107's own description), leaving the
 *   raw markdown unconverted. Calling `marked.parse` directly avoids that trap.
 *
 * Idempotent for Web-written HTML, so Web round-trips don't drift.
 */
export function normalizeRichText(
  input: string | null | undefined
): string | null {
  if (input == null) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  if (looksLikeHtmlDocument(input)) return input
  return marked.parse(trimmed, { async: false }) as string
}
