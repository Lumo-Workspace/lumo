import { marked } from 'marked'

const TurndownService = require('turndown') as new (options?: object) => {
  turndown(html: string): string
}

/**
 * Detect whether a string is likely HTML (as opposed to plain markdown).
 * Looks for common HTML tags that would appear in rich-text content.
 */
export function isHtml(text: string): boolean {
  return /<(?:p|div|span|br|h[1-6]|ul|ol|li|a\b|strong|em|code|pre|blockquote|table|img\b)[>\s/]/i.test(
    text
  )
}

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
 * Convert HTML back to Markdown.
 * If the input is already Markdown (no HTML tags), returns it as-is.
 */
export function htmlToMarkdown(html: string): string {
  if (!isHtml(html)) return html
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  return turndown.turndown(html)
}
