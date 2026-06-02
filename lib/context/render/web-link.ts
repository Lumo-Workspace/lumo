import { makeBudgetSection } from '@/lib/context/budget'

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

/** Render a single web-link card body (no section heading). */
export function webLinkCard(l: WebLinkCard): string {
  const titleLine = l.title
    ? `- [${l.title}](${l.url}) — ${l.domain}`
    : `- ${l.url} — ${l.domain}${l.fetchedAt ? '' : '   _(no preview available)_'}`
  const lines: string[] = [titleLine]
  const body = l.note ?? l.description
  if (body) lines.push(`  > ${body.replace(/\n+/g, ' ')}`)
  lines.push(`  ↳ 正文: lumo task web show ${l.id}`)
  return lines.join('\n')
}

/** One-line manifest for an overflowed web link. */
export function webLinkManifest(l: WebLinkCard): string {
  const label = l.title ? `[${l.title}](${l.url})` : l.url
  return `- ${label} — lumo task web show ${l.id}`
}

/**
 * Render the "## Web Links" section. Unchanged public output; now composed
 * from `webLinkCard`.
 */
export function renderWebLinkSection(links: WebLinkCard[]): string {
  if (links.length === 0) return ''
  const lines: string[] = ['## Web Links', '']
  for (const l of links) lines.push(webLinkCard(l))
  lines.push('')
  return lines.join('\n').trimEnd()
}

/** Budget-section wrapper for web links (LUM-147). */
export function webLinkBudgetSection(links: WebLinkCard[]) {
  // Single-newline separator to match `renderWebLinkSection`, which packs web
  // cards with no blank line between them (same reason `prBudgetSection` does).
  return makeBudgetSection('## Web Links', links, webLinkCard, webLinkManifest, '\n')
}
