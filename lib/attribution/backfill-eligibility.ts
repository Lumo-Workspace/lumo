import type { SessionRole } from '@prisma/client'

/** The session fields the backfill eligibility predicate reads. */
export interface BackfillSessionFields {
  taskId: string | null
  role: SessionRole
  milestoneId: string | null
}

/** LUM-640: a milestone-bound STEWARD session keeps its events task-less. */
export function isStewardBinding(
  s: Pick<BackfillSessionFields, 'role' | 'milestoneId'> | null | undefined
): boolean {
  return s?.role === 'STEWARD' && s.milestoneId !== null
}

/**
 * LUM-932 P3: may the recompute backfill this session's events? Explicit
 * binding always wins (the session and its parent are unbound), and STEWARD
 * sessions — and children of a STEWARD parent — are never backfilled.
 * The single predicate behind both the pure assignment and the commit's
 * in-transaction re-check. `parent` is null/undefined for a root.
 */
export function isBackfillEligible(
  session: BackfillSessionFields,
  parent: BackfillSessionFields | null | undefined
): boolean {
  if (session.taskId !== null || (parent?.taskId ?? null) !== null) return false
  return !isStewardBinding(session) && !isStewardBinding(parent)
}
