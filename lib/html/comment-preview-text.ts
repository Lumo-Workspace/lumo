/**
 * LUM-921 — plain-text preview of a stored comment body (quote chips, "replying
 * to" previews). Parses with DOMParser into a detached document: scripts never
 * run and images never load there. Parsing into an element of the page's own
 * document (even unmounted) DOES load `<img src=x onerror=…>` and fires the
 * handler on Lumo's origin — the bug this replaces.
 *
 * Without a DOM (SSR) it falls back to a tag strip; the result is only ever
 * rendered as a React text node.
 */
export const COMMENT_PREVIEW_MAX = 120

export function commentPreviewText(
  html: string,
  max: number = COMMENT_PREVIEW_MAX
): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    // Script/style source is not something a reader wrote — keep it out.
    for (const n of doc.querySelectorAll('script, style')) n.remove()
    return (doc.body.textContent ?? '').trim().slice(0, max) || '…'
  }
  return html.replace(/<[^>]+>/g, '').slice(0, max)
}
