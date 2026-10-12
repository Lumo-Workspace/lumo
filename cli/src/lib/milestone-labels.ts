/**
 * LUM-1089 — milestone state / health labels shared by `milestone list` and
 * `milestone show`, so both print the same upper-case words (one definition,
 * no per-command copies).
 */

export type MilestoneHealth = 'on-track' | 'at-risk' | 'overdue'

export const HEALTH_LABEL: Record<MilestoneHealth, string> = {
  'on-track': 'ON-TRACK',
  'at-risk': 'AT-RISK',
  overdue: 'OVERDUE',
}

/** Target-date risk light, or `-` when no light applies. */
export function formatHealth(
  health: MilestoneHealth | null | undefined
): string {
  return health ? HEALTH_LABEL[health] : '-'
}

export type MilestoneState = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'

/** LUM-714: the milestone's state, folded from its two timestamps. */
export function milestoneState(m: {
  completedAt: string | null
  archivedAt: string | null
}): MilestoneState {
  if (m.archivedAt) return 'ARCHIVED'
  return m.completedAt ? 'COMPLETED' : 'ACTIVE'
}
