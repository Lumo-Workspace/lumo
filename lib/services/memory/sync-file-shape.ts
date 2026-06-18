import { createHash } from 'node:crypto'
import {
  renderMemoryItem,
  memoryHeadline,
  type RenderableMemory,
} from '@/lib/memory/render'
import type { MemorySyncEntry } from '@/lib/services/memory/sync-bundle'

/** A sync entry plus the local-file projection the CLI writes. */
export interface ShapedSyncEntry extends MemorySyncEntry {
  relPath: string
  frontmatter: string
  indexLine: string
}

/** The over-the-wire downsync bundle the server returns and the CLI writes. */
export interface ShapedSyncBundle {
  projectId: string
  entries: ShapedSyncEntry[]
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'memory'
  )
}

/**
 * Render one team memory into Claude Code local-file shape. The body is the
 * canonical {@link renderMemoryItem} output; the contentHash is sha256 of that
 * body ONLY (never the syncedAt stamp) so re-syncing the same content is a
 * no-op and a drifted on-disk body is detectable. The `metadata.lumo` marker is
 * what the CLI uses to recognise files it owns — dev-authored files lack it and
 * are never touched.
 */
export function toSyncEntry(
  m: RenderableMemory,
  syncedAtIso: string
): ShapedSyncEntry {
  const body = renderMemoryItem(m)
  const contentHash = createHash('sha256').update(body).digest('hex')
  const description = memoryHeadline(m)
  const slug = slugify(description)
  const frontmatter = [
    '---',
    `name: ${slug}`,
    `description: ${JSON.stringify(description)}`,
    'metadata:',
    '  type: project',
    `  lumo: { id: ${m.id}, category: ${m.category}, scope: ${m.scope}, source: team, contentHash: ${contentHash}, syncedAt: ${syncedAtIso} }`,
    '---',
  ].join('\n')
  return {
    id: m.id,
    slug,
    category: m.category,
    scope: m.scope,
    description,
    body,
    contentHash,
    relPath: `team/${m.id}.md`,
    frontmatter,
    indexLine: `- [${description}](team/${m.id}.md) — ${m.category}`,
  }
}
