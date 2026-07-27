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

/**
 * The lifecycle read as a line rather than a graph — the order a healthy idea
 * travels in. Used by the "advance" affordance below; the transition map above
 * stays the authority on what is *legal*, this only says which legal move is
 * the forward one.
 */
const IDEA_STATUS_ORDER: readonly IdeaStatus[] = [
  'CAPTURED',
  'DEVELOPING',
  'PLANNED',
  'DROPPED',
]

/**
 * The next status a one-click "advance" control should move `from` to: the
 * earliest legal target that sits *after* `from` in the lifecycle order, or
 * `null` when there is none (DROPPED is terminal, so its badge is inert).
 *
 * Deliberately never wraps around. The pool's status badge (LUM-708) cycles
 * CAPTURED → DEVELOPING → PLANNED → DROPPED and then stops: DROPPED has no
 * outgoing transition, and silently re-opening a discarded idea by clicking one
 * step too far would be a destructive surprise.
 */
export function nextIdeaStatus(from: IdeaStatus): IdeaStatus | null {
  const allowed = IDEA_STATUS_TRANSITIONS[from]
  const after = IDEA_STATUS_ORDER.slice(IDEA_STATUS_ORDER.indexOf(from) + 1)
  return after.find(status => allowed.includes(status)) ?? null
}
