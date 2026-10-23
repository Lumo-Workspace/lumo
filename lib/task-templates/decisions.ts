import { parse, HTMLElement } from 'node-html-parser'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import { DECISIONS_HEADING } from './system'

const HEADING = /^h([1-6])$/i
const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2})\b\s*[—–:-]?\s*/
/** The LUM-970 template hint left under an empty `## Decisions` heading. */
const TEMPLATE_HINT = /^_?dated rulings, appended as work goes\b/i

function headingLevel(el: HTMLElement): number | null {
  const m = HEADING.exec(el.tagName ?? '')
  return m ? Number(m[1]) : null
}

export interface LegacyDecision {
  /** Inline Markdown, without the leading date. */
  text: string
  /**
   * The YYYY-MM-DD the line started with, else null. Stored at 12:00 UTC so
   * the tab (which shows the viewer's local date) shows that same day in
   * every timezone from UTC−11 to UTC+11.
   */
  date: Date | null
}

function toDecision(html: string): LegacyDecision | null {
  const markdown = htmlToMarkdown(html)
    .replace(/\s*\n\s*/g, ' ')
    .trim()
  if (!markdown || TEMPLATE_HINT.test(markdown)) return null
  const m = LEADING_DATE.exec(markdown)
  if (!m) return { text: markdown, date: null }
  const date = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  )
  const text = markdown.slice(m[0].length).trim()
  if (!text) return null
  return { text, date: Number.isNaN(date.getTime()) ? null : date }
}

/**
 * LUM-1303: take the LUM-970 `## Decisions` section out of a task description
 * (stored as HTML), for the one-time move into the TaskDecision table.
 *
 * The section is the first heading whose text is "Decisions" up to the next
 * heading of the same or a higher level. Each list item becomes one decision,
 * as does any other paragraph in it (the empty-template hint is dropped). A
 * leading `YYYY-MM-DD` — what `lumo task decide` used to prefix — becomes the
 * decision's date. The rest of the description is left byte-for-byte alone.
 *
 * Returns null when the description has no such section.
 */
export function splitDecisionsSection(
  html: string | null
): { description: string; decisions: LegacyDecision[] } | null {
  if (!html) return null
  const root = parse(html)
  const blocks = root.childNodes.filter(
    (n): n is HTMLElement => n instanceof HTMLElement
  )
  const start = blocks.findIndex(
    el =>
      headingLevel(el) !== null &&
      el.text.trim().toLowerCase() === DECISIONS_HEADING.toLowerCase()
  )
  if (start === -1) return null

  const level = headingLevel(blocks[start] as HTMLElement) as number
  let end = blocks.length
  for (let i = start + 1; i < blocks.length; i++) {
    const l = headingLevel(blocks[i] as HTMLElement)
    if (l !== null && l <= level) {
      end = i
      break
    }
  }

  const decisions: LegacyDecision[] = []
  for (const el of blocks.slice(start + 1, end)) {
    // A sub-heading inside the section is structure, not a ruling.
    if (headingLevel(el) !== null) continue
    const tag = el.tagName.toLowerCase()
    const parts =
      tag === 'ul' || tag === 'ol'
        ? el.childNodes
            .filter(
              (n): n is HTMLElement =>
                n instanceof HTMLElement && n.tagName.toLowerCase() === 'li'
            )
            .map(li => li.innerHTML)
        : [el.outerHTML]
    for (const part of parts) {
      const d = toDecision(part)
      if (d) decisions.push(d)
    }
  }

  // Remove the heading and its blocks plus any whitespace text between them.
  const first = blocks[start] as HTMLElement
  const stop = blocks[end] ?? null
  const nodes = root.childNodes
  const from = nodes.indexOf(first)
  const to = stop ? nodes.indexOf(stop) : nodes.length
  for (const n of nodes.slice(from, to)) n.remove()

  return { description: root.toString().trim(), decisions }
}
