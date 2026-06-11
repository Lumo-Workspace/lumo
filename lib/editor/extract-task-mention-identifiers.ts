const IDENTIFIER_RE = /^[A-Za-z]{1,10}-\d+$/
const LEADING_IDENTIFIER_RE = /^([A-Za-z]{1,10}-\d+)\b/

/**
 * Collect the distinct task identifiers (`TEAM-N`, uppercased) referenced by
 * task-mention anchors in a doc's stored HTML. Drives the single batched
 * live-status lookup behind the mention chips (LUM-411) — pure, never throws,
 * returns [] when the DOM can't be parsed.
 *
 * Identifier source: the `data-label` attribute the mention serializer emits;
 * if absent (older content), the leading `TEAM-N` token of the anchor text.
 */
export function extractTaskMentionIdentifiers(html: string): string[] {
  if (!html) return []
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return []
  }
  const out = new Set<string>()
  doc.querySelectorAll('a.mention.mention-task').forEach(el => {
    const raw =
      el.getAttribute('data-label') ??
      LEADING_IDENTIFIER_RE.exec(el.textContent?.trim() ?? '')?.[1] ??
      ''
    if (IDENTIFIER_RE.test(raw)) out.add(raw.toUpperCase())
  })
  return [...out]
}
