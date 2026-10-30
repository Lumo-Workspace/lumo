export interface DocumentCard {
  id: string
  /** LUM-1230: `<title>-<number>`, the handle `lumo doc show` takes. */
  slug?: string | null
  title: string
  summary: string | null
  /**
   * LUM-1343: the body is mirrored from an outside system, so the card is
   * labeled with its origin like other externally-fetched entries.
   */
  external?: 'feishu'
}

/**
 * Render the "## Documents" section. Each mentioned document becomes a card:
 * a `### title` heading, the cached one-line summary (when present), and the
 * retrieval command for the full document.
 */
export function renderDocumentSection(docs: DocumentCard[]): string {
  if (docs.length === 0) return ''

  const lines: string[] = ['## Documents', '']

  for (const d of docs) {
    const origin = d.external ? `[external:${d.external}] ` : ''
    lines.push(`### ${origin}${d.title}`)
    const summary = d.summary?.trim()
    if (summary) lines.push(summary)
    lines.push(`  ↳ full text: lumo doc show ${d.slug || d.id}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
