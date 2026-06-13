/** Derives an always-on digest of a run's turn summaries from STOP/STOP_FAILURE
 *  hook events, sorted by time with empties dropped, capped to the most recent
 *  MAX_LINES entries (LUM-481). */

import type { AgentRunItem } from '../../types'

const MAX_LINES = 5

export function deriveRunDigest(items: AgentRunItem[]): string[] {
  const lines = items
    .filter(
      (i): i is Extract<AgentRunItem, { kind: 'hook' }> =>
        i.kind === 'hook' && (i.type === 'STOP' || i.type === 'STOP_FAILURE')
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(i => i.turnSummary)
    .filter((t): t is string => !!t && t.trim().length > 0)
  return lines.slice(-MAX_LINES)
}
