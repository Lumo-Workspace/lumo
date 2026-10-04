import { parse, HTMLElement } from 'node-html-parser'
import { marked } from 'marked'
import { DECISIONS_HEADING } from './system'

const HEADING = /^h([1-6])$/i

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
 * `text` is Markdown-inline (`code`, **bold**, links), same as the rest of the
 * CLI's description input.
 */
export function appendDecision(html: string | null, text: string): string {
  const inline = (marked.parseInline(text.trim(), { async: false }) as string)
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
