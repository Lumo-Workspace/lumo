/**
 * LUM-916 — THE allowlist for stored rich-text HTML, shared by both
 * sanitizers so they cannot drift:
 *   - server: `sanitize-rich-html.ts` (sanitize-html, no DOM needed) — the
 *     public `/share/<token>` page
 *   - browser: `sanitize-rich-html.client.ts` (DOMPurify on the real DOM,
 *     ~9KB vs ~58KB gz) — descriptions, comments, previews, diffs
 * `__tests__/lib/html/sanitize-rich-html.test.ts` runs the same fidelity +
 * attack matrix against both.
 *
 * Stored HTML is NOT trusted: the API accepts raw HTML from any workspace
 * member (and agents), so a body can carry `<img onerror>`, `javascript:`
 * links or `<iframe>`; rendered as-is on Lumo's origin it runs as the viewer.
 *
 * The allowlist mirrors what the editor (lib/editor/extensions.ts) emits:
 * StarterKit blocks/marks, tables, task lists, images, links, highlight;
 * custom nodes/marks keep their state in `data-*` attributes (inert — nothing
 * executes them); a few fixed classes; inline styles limited to colour,
 * highlight background, alignment and table widths, with value patterns that
 * cannot smuggle `url()`. Everything else is dropped — event handlers,
 * scripts, iframes, forms, arbitrary classes (UI-spoofing overlays), and any
 * URL scheme other than http(s)/mailto.
 */

import { EDITOR_LINK_CLASS } from '@/lib/editor/link-class'

export const RICH_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'mark',
  'sub',
  'sup',
  'code',
  'pre',
  'span',
  'div',
  'a',
  'img',
  'ul',
  'ol',
  'li',
  'label',
  'input',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'colgroup',
  'col',
  'details',
  'summary',
] as const

/** Allowed on every tag, besides `data-*`. */
export const GLOBAL_ATTRIBUTES = ['style'] as const

/** Per-tag attributes. `class` appears only where RICH_CLASSES filters it. */
export const RICH_ATTRIBUTES: Record<string, readonly string[]> = {
  a: ['href', 'title', 'target', 'rel', 'class'],
  span: ['class'],
  code: ['class'],
  pre: ['class'],
  ins: ['class'],
  del: ['class'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  ol: ['start'],
  th: ['colspan', 'rowspan', 'colwidth'],
  td: ['colspan', 'rowspan', 'colwidth'],
  col: ['span'],
  input: ['type', 'checked', 'disabled'],
  details: ['open'],
}

/** Per-tag class values; a trailing `*` matches a prefix. */
export const RICH_CLASSES: Record<string, readonly string[]> = {
  a: [...EDITOR_LINK_CLASS.split(' '), 'mention', 'mention-*', 'task-link'],
  span: ['mention', 'mention-*', 'comment-highlight', 'hljs-*'],
  code: ['language-*', 'hljs', 'hljs-*'],
  pre: ['language-*', 'hljs'],
  ins: ['diff-ins'],
  del: ['diff-del'],
}

const COLOR =
  /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20}|var\(--[a-z0-9-]+\)|inherit|transparent)$/i
const LENGTH = /^\d{1,4}(\.\d+)?(px|%|em|rem)$/
const ALIGN = /^(left|right|center|justify|start|end)$/
const TABLE_WIDTHS = { width: [LENGTH], 'min-width': [LENGTH] }

/** Allowed inline style properties and value patterns, per tag (`*` = all). */
export const RICH_STYLES: Record<string, Record<string, RegExp[]>> = {
  '*': { color: [COLOR], 'background-color': [COLOR], 'text-align': [ALIGN] },
  table: TABLE_WIDTHS,
  col: TABLE_WIDTHS,
  th: TABLE_WIDTHS,
  td: TABLE_WIDTHS,
}

export const URL_SCHEMES = ['http', 'https', 'mailto'] as const
export const IMG_URL_SCHEMES = ['http', 'https'] as const
/** rel forced onto every `target="_blank"` link. */
export const BLANK_REL = 'noopener noreferrer nofollow'

export function isAllowedClass(tag: string, cls: string): boolean {
  return (RICH_CLASSES[tag] ?? []).some(p =>
    p.endsWith('*') ? cls.startsWith(p.slice(0, -1)) : cls === p
  )
}

export function isAllowedStyle(
  tag: string,
  prop: string,
  value: string
): boolean {
  const patterns = RICH_STYLES[tag]?.[prop] ?? RICH_STYLES['*']?.[prop]
  return !!patterns && patterns.some(re => re.test(value))
}

/** A relative URL (same origin) or one of the allowed schemes. */
export function isAllowedUrl(tag: string, url: string): boolean {
  // Browsers drop tabs/newlines anywhere in a URL and leading C0/space, so
  // `java\tscript:` IS `javascript:` — strip them before reading the scheme.
  const v = url.replace(/[\u0000-\u0020\u007f]/g, '')
  if (v.startsWith('//')) return false
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1]?.toLowerCase()
  if (!scheme) return true
  const allowed: readonly string[] =
    tag === 'img' ? IMG_URL_SCHEMES : URL_SCHEMES
  return allowed.includes(scheme)
}
