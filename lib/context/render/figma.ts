import type { TaskFigmaLink } from '@prisma/client'
import { makeBudgetSection } from '@/lib/context/budget'

function figmaTitle(link: TaskFigmaLink): string {
  return link.frameName
    ? `${link.fileName} · ${link.frameName}`
    : `${link.fileName} _(file-level)_`
}

/** Render a single Figma link card body (no section heading). */
export function figmaCard(link: TaskFigmaLink): string {
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
  lines.push(`  ↳ design context: lumo task figma context ${link.id}`)
  return lines.join('\n')
}

/** One-line manifest for an overflowed Figma link. */
export function figmaManifest(link: TaskFigmaLink): string {
  return `- [external:figma] ${figmaTitle(link)} — lumo task figma context ${link.id}`
}

/**
 * Render the "## Figma Designs" section. Unchanged public output; now composed
 * from `figmaCard`.
 */
export function renderFigmaSection(links: TaskFigmaLink[]): string {
  if (links.length === 0) return ''
  const lines: string[] = ['## Figma Designs', '']
  for (const link of links) {
    lines.push(figmaCard(link))
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** Budget-section wrapper for Figma links (LUM-147). */
export function figmaBudgetSection(links: TaskFigmaLink[]) {
  return makeBudgetSection('## Figma Designs', links, figmaCard, figmaManifest)
}
