/**
 * One-shot script to recover task descriptions that were stored as a
 * single <p> wrapping still-markdown text. Run with --apply to write;
 * default is dry-run.
 *
 * Authorization is required before --apply against prod (same gate as
 * `prisma migrate deploy`).
 */
import { markdownToHtml, isMarkdown } from '@/lib/utils/markdown'

const SINGLE_P = /^\s*<p>([\s\S]+)<\/p>\s*$/i
const NESTED_BLOCK = /<(p|div|h[1-6]|ul|ol|li|pre|blockquote|table)\b/i

export function shouldBackfill(html: string | null): boolean {
  if (!html) return false
  const single = SINGLE_P.exec(html)
  if (!single) return false
  const inner = single[1]
  if (NESTED_BLOCK.test(inner)) return false
  return isMarkdown(inner)
}

export function rebuild(html: string): string {
  const match = SINGLE_P.exec(html)
  if (!match) return html
  const decoded = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return markdownToHtml(decoded)
}
