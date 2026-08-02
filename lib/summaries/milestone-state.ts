/**
 * The one-word state of a milestone (LUM-714).
 *
 * A milestone has no stored status. Everything it can be is a fold of two
 * timestamps:
 *
 *  - `archivedAt` — the single explicit human choice ("put this away"). It
 *    outranks completion: a milestone archived mid-flight was dropped, and one
 *    archived after delivery is still, first and foremost, put away.
 *  - `completedAt` — never chosen, derived from task completion by the rollup
 *    (`@/lib/summaries/milestone-rollup`) and merely materialized here.
 *
 * Shared by the server folds and the client — pure, no Prisma runtime import,
 * so it is safe on both sides of the boundary.
 */
export type MilestoneState = 'active' | 'completed' | 'archived'

export function milestoneState(m: {
  completedAt: Date | string | null
  archivedAt: Date | string | null
}): MilestoneState {
  if (m.archivedAt != null) return 'archived'
  if (m.completedAt != null) return 'completed'
  return 'active'
}
