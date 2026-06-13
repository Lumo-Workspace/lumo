import { taskRepository } from '@/lib/repositories/task.repository'
import type { MentionPrState, MentionStatusItem } from '@/types/mention'

/** Pure: `<TEAM>-<n>` → its parts (uppercased), or null if it isn't one. */
export function parseTaskIdentifier(
  raw: string
): { prefix: string; number: number } | null {
  const m = /^([A-Za-z]{1,10})-(\d+)$/.exec(raw.trim())
  if (!m) return null
  return { prefix: m[1]!.toUpperCase(), number: Number(m[2]) }
}

/** Pure: collapse a task's PRs into one badge state. Merged wins, then open. */
export function reducePrState(prs: { state: string }[]): MentionPrState {
  if (prs.some(p => p.state === 'merged')) return 'merged'
  if (prs.some(p => p.state === 'open')) return 'open'
  return 'none'
}

/**
 * Resolve a batch of task identifiers to their current status + PR state in a
 * single workspace-scoped query. Identifiers that don't parse, or that the
 * caller can't see (absent from the scoped query), are omitted — the render
 * side degrades those mentions to a plain chip.
 */
export const mentionStatusService = {
  async resolve(
    workspaceId: string,
    identifiers: string[]
  ): Promise<MentionStatusItem[]> {
    // Dedupe + parse; bail before touching the DB when nothing is valid.
    const parsed = new Map<string, { prefix: string; number: number }>()
    for (const raw of identifiers) {
      const p = parseTaskIdentifier(raw)
      if (p) parsed.set(`${p.prefix}-${p.number}`, p)
    }
    if (parsed.size === 0) return []

    const rows = await taskRepository.findManyForMentionStatus(workspaceId, [
      ...parsed.values(),
    ])

    return rows.map(r => ({
      identifier: `${r.team.identifier}-${r.number}`,
      status: r.status,
      pr: reducePrState(r.pullRequests),
    }))
  },
}
