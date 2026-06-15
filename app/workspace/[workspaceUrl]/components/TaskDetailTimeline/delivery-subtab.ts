import type { DeliverySubTab } from './DeliveryTab'

/**
 * Which delivery sub-segment a task lands on by default (LUM-520). Pure so the
 * decision is unit-testable without mounting TimelineTabs.
 *
 * - `IN_REVIEW` + a contract → Acceptance: the adjudication surface (LUM-471).
 * - any OPEN boundary crossing → Acceptance, even with no criteria and not in
 *   review: otherwise a task whose only delivery signal is a crossing would land
 *   on Runs and the crossing (which lives on the Acceptance sub-segment) would
 *   stay hidden behind the "no criteria" empty state.
 * - otherwise → Runs.
 *
 * Only governs the initial landing; an explicit sub-segment click overrides it.
 */
export function resolveDefaultDeliverySubTab({
  status,
  hasCriteria,
  hasOpenCrossings,
}: {
  status: string | undefined
  hasCriteria: boolean
  hasOpenCrossings: boolean
}): DeliverySubTab {
  if ((status === 'IN_REVIEW' && hasCriteria) || hasOpenCrossings) {
    return 'acceptance'
  }
  return 'runs'
}
