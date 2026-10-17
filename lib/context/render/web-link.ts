import { shortRef } from '@/shared/src/short-ref'
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
 * Render a single web-link card body (no section heading). `identifier` is the
 * LUM-N task identifier — the first positional of the on-demand fetch command,
 * not the cuid.
 */
export function webLinkCard(l: WebLinkCard, identifier: string): string {
  // LUM-347: entry-level source attribution — fetched external web content.
  const titleLine = l.title
    ? `- [external:web] [${l.title}](${l.url}) — ${l.domain}`
    : `- [external:web] ${l.url} — ${l.domain}${l.fetchedAt ? '' : '   _(no preview available)_'}`
  const lines: string[] = [titleLine]
  const body = l.note ?? l.description
  if (body) lines.push(`  > ${body.replace(/\n+/g, ' ')}`)
  lines.push(`  ↳ body: lumo task web show ${identifier} ${shortRef(l.id)}`)
  return lines.join('\n')
}

/**
 * Truncate a one-line descriptor for a manifest line. Collapses internal
 * whitespace, then clips at `max` chars with an ellipsis. Returns "" for
 * empty/whitespace-only input.
 */
function truncateDescriptor(text: string, max = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return ''
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * One-line manifest for a Tier-2 web link (LUM-500): the page title (truncated)
 * plus the host so an agent can decide whether to pull the body, plus the
 * retrieval hint. Falls back to url + host when there is no title.
 *
 * `identifier` is the human task id (e.g. "LUM-42") — emitted as the first
 * positional of the `lumo task web show` hint so an agent can run it verbatim.
 */
export function webLinkManifest(l: WebLinkCard, identifier: string): string {
  const title = truncateDescriptor(l.title ?? '')
  const descriptor = title ? `${title} — ${l.domain}` : `${l.url} — ${l.domain}`
  return `- [external:web] ${descriptor} → lumo task web show ${identifier} ${shortRef(l.id)}`
}

/**
 * Render the "## Web Links" section. Unchanged public output; now composed
 * from `webLinkCard`.
 */
export function renderWebLinkSection(
  links: WebLinkCard[],
  identifier: string
): string {
  if (links.length === 0) return ''
  const lines: string[] = ['## Web Links', '']
  for (const l of links) lines.push(webLinkCard(l, identifier))
  lines.push('')
  return lines.join('\n').trimEnd()
}
