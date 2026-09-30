import DOMPurify from 'dompurify'
import {
  BLANK_REL,
  GLOBAL_ATTRIBUTES,
  RICH_ATTRIBUTES,
  RICH_TAGS,
  isAllowedClass,
  isAllowedStyle,
  isAllowedUrl,
} from './rich-html-policy'

/**
 * LUM-916 — BROWSER sanitizer for stored rich-text HTML: DOMPurify on the
 * real DOM (~9KB gz; sanitize-html would add ~58KB to every page that shows
 * a comment). Same allowlist as the server sanitizer (`rich-html-policy.ts`);
 * per-tag attributes, class values, style values and URL schemes are
 * enforced in DOMPurify hooks because its own config is tag-agnostic.
 *
 * Browser-only: DOMPurify needs `window`. `RichHtml` renders nothing on the
 * server and sanitizes after mount.
 */

type Purifier = ReturnType<typeof DOMPurify>
let purifier: Purifier | null = null

const ALL_ATTRIBUTES = [
  ...new Set([...GLOBAL_ATTRIBUTES, ...Object.values(RICH_ATTRIBUTES).flat()]),
]

function keepStyle(tag: string, value: string): string {
  return value
    .split(';')
    .flatMap(decl => {
      const i = decl.indexOf(':')
      if (i < 0) return []
      const prop = decl.slice(0, i).trim().toLowerCase()
      const val = decl.slice(i + 1).trim()
      return isAllowedStyle(tag, prop, val) ? [`${prop}: ${val}`] : []
    })
    .join('; ')
}

function build(): Purifier {
  const p = DOMPurify(window)
  p.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName.toLowerCase()
    const name = data.attrName
    if (name.startsWith('data-')) return
    const allowed =
      (GLOBAL_ATTRIBUTES as readonly string[]).includes(name) ||
      (RICH_ATTRIBUTES[tag] ?? []).includes(name)
    if (!allowed) {
      data.keepAttr = false
      return
    }
    if (name === 'class') {
      const kept = data.attrValue
        .split(/\s+/)
        .filter(c => c && isAllowedClass(tag, c))
      if (kept.length === 0) data.keepAttr = false
      else data.attrValue = kept.join(' ')
    } else if (name === 'style') {
      const kept = keepStyle(tag, data.attrValue)
      if (!kept) data.keepAttr = false
      else data.attrValue = kept
    } else if (name === 'href' || name === 'src') {
      if (!isAllowedUrl(tag, data.attrValue)) data.keepAttr = false
    }
  })
  p.addHook('afterSanitizeAttributes', node => {
    if (node.nodeName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', BLANK_REL)
    }
    // Only ever a disabled checkbox — never a field that could phish input.
    if (node.nodeName === 'INPUT') {
      const checked = node.hasAttribute('checked')
      for (const attr of [...node.attributes]) node.removeAttribute(attr.name)
      node.setAttribute('type', 'checkbox')
      node.setAttribute('disabled', '')
      if (checked) node.setAttribute('checked', '')
    }
  })
  return p
}

export function sanitizeRichHtmlInBrowser(
  html: string | null | undefined
): string {
  if (!html) return ''
  purifier ??= build()
  return purifier.sanitize(html, {
    ALLOWED_TAGS: [...RICH_TAGS],
    ALLOWED_ATTR: ALL_ATTRIBUTES,
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  })
}
