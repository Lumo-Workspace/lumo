import { diffWords } from 'diff'

export interface DiffSegment {
  value: string
  added: boolean
  removed: boolean
}

/** Word-level diff of two plain-text strings. */
export function diffDocumentText(
  oldText: string,
  newText: string
): DiffSegment[] {
  return diffWords(oldText, newText).map(part => ({
    value: part.value,
    added: part.added === true,
    removed: part.removed === true,
  }))
}

/**
 * Convert an HTML body to readable plain text for diffing. Browser/jsdom only
 * (uses DOMParser). Block elements are separated by newlines so paragraph
 * boundaries survive into the diff.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc
    .querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, br, blockquote, pre')
    .forEach(el => el.append('\n'))
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}
