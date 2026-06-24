/** Derives an always-on digest of a run's turn summaries from STOP/STOP_FAILURE
 *  hook events, sorted by time with empties dropped, capped to the most recent
 *  MAX_LINES entries (LUM-481). LUM-574: meta-reasoning turn notes are filtered
 *  out via the same `filterMetaReasoning` the CLI digest (`selectClaim`) uses,
 *  so the web delivery card and the CLI claim stay same-source and neither
 *  surfaces the summarizer's leaked deliberation. */

import type { AgentRunItem } from '../../types'
import { filterMetaReasoning } from '@/lib/services/meta-reasoning'

const MAX_LINES = 5

export function deriveRunDigest(items: AgentRunItem[]): string[] {
  const lines = items
    .filter(
      (i): i is Extract<AgentRunItem, { kind: 'hook' }> =>
        i.kind === 'hook' && (i.type === 'STOP' || i.type === 'STOP_FAILURE')
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(i => i.turnSummary)
    .filter((t): t is string => !!t)
  return filterMetaReasoning(lines).slice(-MAX_LINES)
}
