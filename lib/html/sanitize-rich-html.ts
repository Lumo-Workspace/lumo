import sanitize from 'sanitize-html'
import {
  BLANK_REL,
  GLOBAL_ATTRIBUTES,
  IMG_URL_SCHEMES,
  RICH_ATTRIBUTES,
  RICH_CLASSES,
  RICH_STYLES,
  RICH_TAGS,
  URL_SCHEMES,
  isAllowedUrl,
} from './rich-html-policy'

/**
 * LUM-916 — SERVER-side sanitizer for stored rich-text HTML (sanitize-html:
 * a pure parser, no DOM). Used by the public `/share/<token>` page. Browser
 * components use `sanitize-rich-html.client.ts` instead (DOMPurify, a
 * fraction of the bundle). Both read `rich-html-policy.ts`.
 */
const OPTIONS: sanitize.IOptions = {
  allowedTags: [...RICH_TAGS],
  allowedAttributes: {
    '*': ['data-*', ...GLOBAL_ATTRIBUTES],
    ...Object.fromEntries(
      Object.entries(RICH_ATTRIBUTES).map(([tag, attrs]) => [tag, [...attrs]])
    ),
  },
  allowedClasses: Object.fromEntries(
    Object.entries(RICH_CLASSES).map(([tag, classes]) => [tag, [...classes]])
  ),
  allowedStyles: RICH_STYLES,
  allowedSchemes: [...URL_SCHEMES],
  allowedSchemesByTag: { img: [...IMG_URL_SCHEMES] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  transformTags: {
    // Only ever a disabled checkbox — never a field that could phish input.
    input: (_tag, attribs) => ({
      tagName: 'input',
      attribs: {
        type: 'checkbox',
        disabled: '',
        ...('checked' in attribs ? { checked: '' } : {}),
      },
    }),
    a: (_tag, attribs) => {
      const next = { ...attribs }
      // Belt and braces over allowedSchemes: the policy's own URL check.
      if (next.href !== undefined && !isAllowedUrl('a', next.href))
        delete next.href
      if (next.target === '_blank') next.rel = BLANK_REL
      return { tagName: 'a', attribs: next }
    },
  },
}

export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return ''
  return sanitize(html, OPTIONS)
}
