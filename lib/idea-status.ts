import type { IdeaStatus } from '@prisma/client'

/**
 * The Idea lifecycle (LUM-679, Spec2-17).
 *
 *   CAPTURED ⇄ DEVELOPING → PLANNED
 *        └────────┴──────────┴──→ DROPPED (terminal)
 *
 * This map governs **user-initiated** status changes (the `lumo idea update`
 * CLI + the web control in LUM-683). Two deliberate rules:
 *
 * - CAPTURED→PLANNED is NOT a manual move. PLANNED means "consumed by an
 *   initiative/plan", so it is only reached through DEVELOPING by hand, or by
 *   the converter's materialisation (a system action that writes the status
 *   directly via the repository, bypassing this map).
 * - DROPPED is terminal — a discarded idea stays discarded; nothing transitions
 *   out of it. It is reachable from every non-terminal state.
 */
export const IDEA_STATUS_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  CAPTURED: ['DEVELOPING', 'DROPPED'],
  DEVELOPING: ['CAPTURED', 'PLANNED', 'DROPPED'],
  PLANNED: ['DROPPED'],
  DROPPED: [],
}

/** The statuses `from` may move to by hand (never includes `from` itself). */
export function allowedIdeaStatusTransitions(from: IdeaStatus): IdeaStatus[] {
  return IDEA_STATUS_TRANSITIONS[from]
}

/**
 * Whether a manual `from → to` status change is allowed. Same-status no-ops are
 * rejected (the map never lists a status as its own target).
 */
export function canTransitionIdeaStatus(
  from: IdeaStatus,
  to: IdeaStatus
): boolean {
  return IDEA_STATUS_TRANSITIONS[from].includes(to)
}

/** A terminal status has no outgoing transitions (only DROPPED, today). */
export function isTerminalIdeaStatus(status: IdeaStatus): boolean {
  return IDEA_STATUS_TRANSITIONS[status].length === 0
}
