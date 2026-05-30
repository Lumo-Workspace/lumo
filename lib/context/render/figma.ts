import type { TaskFigmaLink } from '@prisma/client'

/**
 * Render the "## Figma Designs" section. Keeps the existing file/frame/
 * thumbnail/last-synced metadata and appends the design-context retrieval
 * command per link.
 */
export function renderFigmaSection(links: TaskFigmaLink[]): string {
  if (links.length === 0) return ''
  const lines: string[] = ['## Figma Designs', '']
  for (const link of links) {
    const title = link.frameName
      ? `${link.fileName} · ${link.frameName}`
      : `${link.fileName} _(file-level)_`
    lines.push(`- **${title}**`)
    lines.push(`  - URL: ${link.url}`)
    if (link.thumbnailUrl) {
      lines.push(`  - Thumbnail: ![](${link.thumbnailUrl})`)
    } else {
      const reason = link.lastSyncError
        ? `_(sync failed: ${link.lastSyncError})_`
        : '_(thumbnail not yet fetched)_'
      lines.push(`  - Thumbnail unavailable ${reason}`)
    }
    lines.push(
      `  - Last synced: ${link.lastSyncedAt.toISOString().slice(0, 10)}`
    )
    lines.push(`  ↳ design context: lumo task figma context ${link.id}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
