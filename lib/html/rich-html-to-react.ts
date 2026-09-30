import { createElement, type CSSProperties, type ReactNode } from 'react'
import { parseDocument } from 'htmlparser2'
import { RICH_TAGS } from './rich-html-policy'
import { sanitizeRichHtml } from './sanitize-rich-html'

/**
 * LUM-916 — render stored rich-text HTML as React elements on the server,
 * without `dangerouslySetInnerHTML`. The HTML is sanitized against the shared
 * allowlist first (`sanitizeRichHtml`), then parsed and rebuilt node by node:
 * React escapes every text node and sets every attribute itself, so nothing
 * is ever injected as raw markup — a second line of defence behind the
 * sanitizer, and no innerHTML sink for scanners to flag.
 *
 * Used by the public `/share/<token>` page. `transformUrl` lets the caller
 * rewrite `href`/`src` (the share page appends its share token to private
 * image URLs).
 */

const TAGS = new Set<string>(RICH_TAGS)
const VOID = new Set(['br', 'hr', 'img', 'input', 'col'])
/** Whitespace text is invalid inside these (React warns, browsers drop it). */
const NO_TEXT_CHILDREN = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'colgroup',
])

/** HTML attribute → React prop name, where they differ. */
const PROP_NAMES: Record<string, string> = {
  class: 'className',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  for: 'htmlFor',
}

function styleObject(css: string): CSSProperties {
  const out: Record<string, string> = {}
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    const value = decl.slice(i + 1).trim()
    if (!prop || !value) continue
    const key = prop.startsWith('--')
      ? prop
      : prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
    out[key] = value
  }
  return out as CSSProperties
}

type Node = ReturnType<typeof parseDocument>['children'][number]
// Narrow by shape (the node-kind enum is a runtime namespace export that
// jest's interop drops) and confirm by `type`, which htmlparser2 sets to
// 'text' / 'tag' — <script>/<style> get their own kinds and never render.
type TextNode = Extract<Node, { data: string }>
type ElementNode = Extract<Node, { attribs: Record<string, string> }>
const isText = (n: Node): n is TextNode => (n.type as string) === 'text'
const isTag = (n: Node): n is ElementNode => (n.type as string) === 'tag'

export interface RichHtmlToReactOptions {
  transformUrl?: (url: string, tag: string) => string
}

function toReact(
  node: Node,
  key: number,
  parentTag: string | null,
  opts: RichHtmlToReactOptions
): ReactNode {
  if (isText(node)) {
    if (parentTag && NO_TEXT_CHILDREN.has(parentTag) && !node.data.trim()) {
      return null
    }
    return node.data
  }
  if (!isTag(node)) return null // comments, directives, CDATA
  const tag = node.name.toLowerCase()
  if (!TAGS.has(tag)) return null

  const props: Record<string, unknown> = { key }
  for (const [name, value] of Object.entries(node.attribs)) {
    if (name === 'style') props.style = styleObject(value)
    else if (name === 'checked') props.defaultChecked = true
    else if (name === 'disabled' || name === 'open') props[name] = true
    else if ((name === 'href' || name === 'src') && opts.transformUrl)
      props[name] = opts.transformUrl(value, tag)
    else props[PROP_NAMES[name] ?? name] = value
  }
  if (tag === 'input') props.readOnly = true

  if (VOID.has(tag)) return createElement(tag, props)
  const children = node.children.map((child, i) =>
    toReact(child as Node, i, tag, opts)
  )
  return createElement(tag, props, ...children)
}

/** Sanitize `html`, then build it as React elements (no innerHTML). */
export function richHtmlToReact(
  html: string | null | undefined,
  opts: RichHtmlToReactOptions = {}
): ReactNode[] {
  const safe = sanitizeRichHtml(html)
  if (!safe) return []
  return parseDocument(safe).children.map((node, i) =>
    toReact(node as Node, i, null, opts)
  )
}
