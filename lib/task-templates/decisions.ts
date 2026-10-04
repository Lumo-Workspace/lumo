import { parse, HTMLElement } from 'node-html-parser'
import { Marked } from 'marked'
import { DECISIONS_HEADING } from './system'

const HEADING = /^h([1-6])$/i

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SAFE_HREF = /^(https?:|mailto:)/i

/**
 * Inline-Markdown renderer for a decision line. Raw HTML in the text is shown
 * as text, never stored as markup, and links keep only http(s)/mailto hrefs —
 * the line comes from a CLI argument, so it is treated as untrusted.
 */
const decisionMarked = new Marked({
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      return SAFE_HREF.test(href)
        ? `<a href="${escapeHtml(href)}">${label}</a>`
        : label
    },
  },
})

function headingLevel(el: HTMLElement): number | null {
  const m = HEADING.exec(el.tagName ?? '')
  return m ? Number(m[1]) : null
}

/**
 * LUM-970: append one decision to a task description (stored as HTML).
 *
 * Finds the first top-level heading whose text is "Decisions" and appends a
 * list item to the list that closes that section; with no list there it adds
 * one, and with no such heading it adds `<h2>Decisions</h2>` at the end. Works
 * on the HTML directly — round-tripping through Markdown is lossy (tables
 * flatten), so the rest of the description is left byte-for-byte alone.
 *
 * `text` is Markdown-inline (`code`, **bold**, links). Raw HTML in it is
 * escaped and only http(s)/mailto links survive.
 */
export function appendDecision(html: string | null, text: string): string {
  const inline = (
    decisionMarked.parseInline(text.trim(), { async: false }) as string
  )
    .replace(/\n+/g, ' ')
    .trim()
  const item = `<li><p>${inline}</p></li>`
  const body = html ?? ''
  const root = parse(body)
  const blocks = root.childNodes.filter(
    (n): n is HTMLElement => n instanceof HTMLElement
  )

  const start = blocks.findIndex(
    el =>
      headingLevel(el) !== null &&
      el.text.trim().toLowerCase() === DECISIONS_HEADING.toLowerCase()
  )
  if (start === -1) {
    return `${body}<h2>${DECISIONS_HEADING}</h2><ul>${item}</ul>`
  }

  const level = headingLevel(blocks[start] as HTMLElement) as number
  let end = blocks.length
  for (let i = start + 1; i < blocks.length; i++) {
    const l = headingLevel(blocks[i] as HTMLElement)
    if (l !== null && l <= level) {
      end = i
      break
    }
  }

  const last = blocks[end - 1] as HTMLElement
  if (end - 1 > start && last.tagName.toLowerCase() === 'ul') {
    last.insertAdjacentHTML('beforeend', item)
  } else {
    last.insertAdjacentHTML('afterend', `<ul>${item}</ul>`)
  }
  return root.toString()
}
