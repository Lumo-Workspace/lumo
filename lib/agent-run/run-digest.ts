/**
 * Pure read-model helpers over a run's merged items[] (hook events +
 * memories), shared by the web run card and the CLI run report (LUM-1188) so
 * the two surfaces show the same digest lines and turn counts.
 *
 * Structural input types on purpose: both the service wire shape and the web
 * types satisfy them, and this file stays client-safe (no server imports).
 */
import { filterMetaReasoning } from '@/lib/services/meta-reasoning'

export interface DigestItem {
  kind: 'hook' | 'memory'
  type?: string
  turnSummary?: string | null
  createdAt: string
}

const MAX_DIGEST_LINES = 5

function isStop(i: DigestItem): boolean {
  return i.kind === 'hook' && (i.type === 'STOP' || i.type === 'STOP_FAILURE')
}

/**
 * The always-on digest of a run's turn summaries from STOP/STOP_FAILURE hook
 * events, sorted by time with empties dropped, capped to the most recent
 * MAX_DIGEST_LINES entries (LUM-481). LUM-574: meta-reasoning turn notes are
 * filtered out via the same `filterMetaReasoning` the CLI claim uses.
 */
export function deriveRunDigest(items: readonly DigestItem[]): string[] {
  const lines = items
    .filter(isStop)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(i => i.turnSummary)
    .filter((t): t is string => !!t)
  return filterMetaReasoning(lines).slice(-MAX_DIGEST_LINES)
}

/**
 * How many turns the web timeline shows for a run: one per STOP /
 * STOP_FAILURE, plus a trailing unterminated turn when hook events follow the
 * last STOP. Same bracketing as the web's `segmentIntoTurns` (memories never
 * open a turn).
 */
export function countRunTurns(items: readonly DigestItem[]): number {
  let turns = 0
  let open = false
  for (const item of items) {
    if (item.kind !== 'hook') continue
    if (isStop(item)) {
      turns++
      open = false
    } else {
      open = true
    }
  }
  return open ? turns + 1 : turns
}
