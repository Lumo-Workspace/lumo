import { listFigmaLinks } from '../lib/figma-api'
import { sanitizeField } from '../lib/sanitize'

const STALE_MS = 25 * 24 * 3600 * 1000

function formatRow(
  id: string,
  fileName: string,
  frame: string,
  synced: string,
  stale: boolean
): string {
  return [
    id.padEnd(10),
    sanitizeField(fileName).padEnd(20),
    sanitizeField(frame).padEnd(24),
    synced.padEnd(12),
    stale ? '⚠ thumbnail stale' : '',
  ]
    .join(' ')
    .trimEnd()
}

export async function taskFigmaList(args: {
  identifier: string
}): Promise<number> {
  const { links } = await listFigmaLinks(args.identifier)
  if (links.length === 0) {
    console.log('No Figma links attached.')
    return 0
  }
  for (const link of links) {
    const frame = link.frameName ?? '(file-level)'
    const synced = link.lastSyncedAt.slice(0, 10)
    const stale =
      link.thumbnailFetchedAt === null ||
      Date.now() - new Date(link.thumbnailFetchedAt).getTime() > STALE_MS
    console.log(
      formatRow(
        link.id,
        link.fileName,
        frame,
        synced,
        stale && !!link.thumbnailUrl
      )
    )
  }
  return 0
}
