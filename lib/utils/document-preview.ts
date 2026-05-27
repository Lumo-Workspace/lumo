import type { TiptapNode } from './markdown-tiptap'

const DEFAULT_MAX_LENGTH = 220

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

const BLOCK_CLOSE_RE = /<\/(?:p|div|h[1-6]|li|blockquote|pre|tr|table|ul|ol)>/gi
const BR_RE = /<br\s*\/?>(?!\s*$)/gi

function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, m => HTML_ENTITY_MAP[m] ?? m)
    .replace(/&#(\d+);/g, (_m, code) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
}

function htmlToPlainText(html: string): string {
  const withBreaks = html.replace(BLOCK_CLOSE_RE, '\n').replace(BR_RE, '\n')
  const stripped = withBreaks.replace(/<[^>]+>/g, '')
  return decodeEntities(stripped)
}

function tiptapToPlainText(node: TiptapNode): string {
  const parts: string[] = []
  const blockTypes = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'listItem',
    'codeBlock',
  ])

  function walk(n: TiptapNode) {
    if (n.type === 'text' && typeof n.text === 'string') {
      parts.push(n.text)
      return
    }
    if (n.type === 'hardBreak') {
      parts.push('\n')
      return
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
    }
    if (blockTypes.has(n.type)) parts.push('\n')
  }

  walk(node)
  return parts.join('')
}

function normalizeWhitespace(s: string): string {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const slice = s.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice
  return `${cut.trimEnd()}…`
}

/**
 * Extract a plain-text preview from a document's stored content.
 *
 * Handles both storage shapes: HTML bodies (current format) and legacy
 * Tiptap JSON strings written by the pre-LUM-83 CLI. Newlines from block
 * boundaries are preserved as paragraph breaks so the frontend can render
 * them via `whitespace-pre-line`.
 *
 * Returns null for null / empty / whitespace-only content so callers can
 * branch on truthiness instead of testing for the empty string.
 */
export function extractDocumentPreview(
  content: string | null | undefined,
  maxLength: number = DEFAULT_MAX_LENGTH
): string | null {
  if (typeof content !== 'string') return null
  const trimmed = content.trim()
  if (trimmed.length === 0) return null

  let plain: string
  if (trimmed.startsWith('{"type":"doc"')) {
    try {
      const parsed = JSON.parse(trimmed) as TiptapNode
      plain = tiptapToPlainText(parsed)
    } catch {
      plain = htmlToPlainText(trimmed)
    }
  } else {
    plain = htmlToPlainText(trimmed)
  }

  const normalized = normalizeWhitespace(plain)
  if (normalized.length === 0) return null
  return truncate(normalized, maxLength)
}
