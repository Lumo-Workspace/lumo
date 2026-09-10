/**
 * LUM-496: the Record tab's boundary-crossings panel lists crossings grouped by
 * category so 27 open rows read as four decisions instead of a wall. Pure — no
 * intl, no React — so the ordering rules are unit-testable on their own.
 */
import type {
  BoundaryCrossingView,
  BoundarySeverity,
} from '../../hooks/useBoundaryCrossings'

export interface CrossingGroup {
  category: string
  /** Highest severity among the group's crossings. */
  severity: BoundarySeverity
  /** True only when EVERY crossing in the group is advisory (never blocks Done). */
  advisory: boolean
  /** Crossings still awaiting a human disposition. */
  open: number
  total: number
  /** The group's crossings, in the order they arrived. */
  crossings: BoundaryCrossingView[]
}

const SEVERITY_RANK: Record<BoundarySeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

/**
 * A group is "blocking" when it still holds an open crossing that actually
 * blocks Done — the same rule the panel applies (LUM-635): advisory never
 * blocks; with the workspace gate opted out only HIGH still blocks (LUM-442).
 */
function isBlocking(group: CrossingGroup, gateEnabled: boolean): boolean {
  return group.crossings.some(
    c =>
      c.disposition == null &&
      !c.advisory &&
      (gateEnabled || c.severity === 'HIGH')
  )
}

/**
 * Groups crossings by category. Order: blocking groups first, then severity
 * (HIGH > MEDIUM > LOW), then open count descending, then category name — so
 * the row a reviewer must act on first is always the top row.
 *
 * `gateEnabled` mirrors the panel's workspace gate flag (default true, erring
 * toward "open blocks" for callers/mocks that predate the field).
 */
export function groupCrossings(
  crossings: BoundaryCrossingView[],
  opts?: { gateEnabled?: boolean }
): CrossingGroup[] {
  const gateEnabled = opts?.gateEnabled ?? true
  const byCategory = new Map<string, CrossingGroup>()

  for (const crossing of crossings) {
    const existing = byCategory.get(crossing.category)
    if (!existing) {
      byCategory.set(crossing.category, {
        category: crossing.category,
        severity: crossing.severity,
        advisory: crossing.advisory,
        open: crossing.disposition == null ? 1 : 0,
        total: 1,
        crossings: [crossing],
      })
      continue
    }
    if (SEVERITY_RANK[crossing.severity] > SEVERITY_RANK[existing.severity]) {
      existing.severity = crossing.severity
    }
    existing.advisory = existing.advisory && crossing.advisory
    if (crossing.disposition == null) existing.open += 1
    existing.total += 1
    existing.crossings.push(crossing)
  }

  return [...byCategory.values()].sort((a, b) => {
    const blocking =
      Number(isBlocking(b, gateEnabled)) - Number(isBlocking(a, gateEnabled))
    if (blocking !== 0) return blocking
    const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (severity !== 0) return severity
    if (b.open !== a.open) return b.open - a.open
    return a.category.localeCompare(b.category)
  })
}
