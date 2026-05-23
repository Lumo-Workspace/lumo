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
