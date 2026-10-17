import { memoryManifestLine, type RenderableMemory } from '@/lib/memory/render'

/**
 * Render the Tier-2 memory index (LUM-500): the top-K most-relevant memories as
 * addressable one-line manifest entries, plus a single pointer line for the
 * remainder. Input is already relevance-ranked (LUM-486 gate + LUM-279 rank),
 * so a plain `slice(0, topK)` keeps the most relevant entries full and the rest
 * become a "+N more — browse with the CLI" pointer.
 *
 * Returns "" for an empty list so the caller can omit the section entirely
 * instead of emitting a bare heading.
 */
export function buildMemoryIndex(
  ordered: RenderableMemory[],
  topK: number
): string {
  if (ordered.length === 0) return ''
  const kept = ordered.slice(0, topK)
  const rest = ordered.length - kept.length
  const lines = [
    '## Relevant Memory (index)',
    '',
    ...kept.map(memoryManifestLine),
  ]
  if (rest > 0) {
    lines.push(
      `- +${rest} more — \`lumo project memory list\` / \`lumo task memory list\` to browse, \`lumo memory show <ref>\` to pull one`
    )
  }
  return lines.join('\n')
}
