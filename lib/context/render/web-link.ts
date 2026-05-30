export interface WebLinkCard {
  id: string
  url: string
  domain: string
  title: string | null
  description: string | null
  note: string | null
  fetchedAt: Date | null
  fetchError: string | null
}

/**
 * Render the "## Web Links" section. Keeps the existing OG title/description
 * card and appends the retrieval command for the fetched page body.
 */
export function renderWebLinkSection(links: WebLinkCard[]): string {
  if (links.length === 0) return ''

  const lines: string[] = ['## Web Links', '']

  for (const l of links) {
    const titleLine = l.title
      ? `- [${l.title}](${l.url}) — ${l.domain}`
      : `- ${l.url} — ${l.domain}${l.fetchedAt ? '' : '   _(no preview available)_'}`
    lines.push(titleLine)
    const body = l.note ?? l.description
    if (body) lines.push(`  > ${body.replace(/\n+/g, ' ')}`)
    lines.push(`  ↳ 正文: lumo task web show ${l.id}`)
  }
  lines.push('')

  return lines.join('\n').trimEnd()
}
