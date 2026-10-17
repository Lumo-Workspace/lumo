import { shortRef } from '@/shared/src/short-ref'
import type { TaskFigmaLink } from '@prisma/client'

function figmaTitle(link: TaskFigmaLink): string {
  return link.frameName
    ? `${link.fileName} · ${link.frameName}`
    : `${link.fileName} _(file-level)_`
}

/**
 * Render a single Figma link card body (no section heading). `identifier` is the
 * LUM-N task identifier — the first positional of the on-demand fetch command,
 * not the cuid.
 */
export function figmaCard(link: TaskFigmaLink, identifier: string): string {
  // LUM-347: entry-level source attribution — synced external Figma metadata.
  const lines: string[] = [`- [external:figma] **${figmaTitle(link)}**`]
  lines.push(`  - URL: ${link.url}`)
  if (link.thumbnailUrl) {
    lines.push(`  - Thumbnail: ![](${link.thumbnailUrl})`)
  } else {
    const reason = link.lastSyncError
      ? `_(sync failed: ${link.lastSyncError})_`
      : '_(thumbnail not yet fetched)_'
    lines.push(`  - Thumbnail unavailable ${reason}`)
  }
  lines.push(`  - Last synced: ${link.lastSyncedAt.toISOString().slice(0, 10)}`)
  lines.push(
    `  ↳ design context: lumo task figma context ${identifier} ${shortRef(link.id)}`
  )
  return lines.join('\n')
}

/**
 * Truncate a one-line descriptor for a manifest line. Collapses internal
 * whitespace, then clips at `max` chars with an ellipsis.
 */
function truncateDescriptor(text: string, max = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * One-line manifest for a Tier-2 Figma link (LUM-500): the file/frame name
 * (truncated) so an agent can decide whether to pull the design context, plus
 * the retrieval hint.
 *
 * `identifier` is the human task id (e.g. "LUM-42") — emitted as the first
 * positional of the `lumo task figma context` hint so an agent can run it
 * verbatim.
 */
export function figmaManifest(link: TaskFigmaLink, identifier: string): string {
  return `- [external:figma] ${truncateDescriptor(figmaTitle(link))} → lumo task figma context ${identifier} ${shortRef(link.id)}`
}

/**
 * Render the "## Figma Designs" section. Unchanged public output; now composed
 * from `figmaCard`.
 */
export function renderFigmaSection(
  links: TaskFigmaLink[],
  identifier: string
): string {
  if (links.length === 0) return ''
  const lines: string[] = ['## Figma Designs', '']
  for (const link of links) {
    lines.push(figmaCard(link, identifier))
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
