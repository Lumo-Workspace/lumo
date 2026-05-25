import { parse, HTMLElement } from 'node-html-parser'

export type Selector = { type: 'marked' } | { type: 'all_unchecked' }

export interface Candidate {
  node: HTMLElement
  text: string
}

/** Parse HTML and return extraction candidates per selector. Internal helper, exported for unit tests. */
export function findExtractionCandidates(
  html: string,
  selector: Selector
): Candidate[] {
  const root = parse(html)
  let nodes: HTMLElement[]

  if (selector.type === 'all_unchecked') {
    nodes = root
      .querySelectorAll('li[data-type="taskItem"][data-checked="false"]')
      .filter(n => n.querySelector('a[data-task-link]') === null)
  } else {
    nodes = root.querySelectorAll('[data-extract-pending="true"]')
  }

  return nodes.map(node => ({
    node,
    text: node.text.trim(),
  }))
}

export interface ReplacementMeta {
  taskId: string
  identifier: string
  href: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function anchorHtml(text: string, meta: ReplacementMeta): string {
  return (
    `<a data-task-link="${meta.taskId}"` +
    ` data-task-identifier="${meta.identifier}"` +
    ` href="${meta.href}">${escapeHtml(text)}</a>`
  )
}

/** Replace one candidate node in place. Mutates the DOM tree. */
export function replaceWithTaskLink(
  node: HTMLElement,
  meta: ReplacementMeta
): void {
  if (node.tagName === 'LI' && node.getAttribute('data-type') === 'taskItem') {
    node.setAttribute('data-task-id', meta.taskId)
    node.setAttribute('data-task-identifier', meta.identifier)
    const inner = node.querySelector('p') ?? node.querySelector('div')
    if (inner) {
      const text = inner.text.trim()
      inner.set_content(anchorHtml(text, meta))
    }
    return
  }
  // <span data-extract-pending> path
  const text = node.text.trim()
  node.replaceWith(anchorHtml(text, meta))
}
