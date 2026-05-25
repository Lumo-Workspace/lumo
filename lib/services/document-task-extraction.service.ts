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
