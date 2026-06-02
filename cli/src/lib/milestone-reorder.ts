export interface MilestoneRef {
  id: string
  name: string
  sortOrder: number
}

export type ResolveResult =
  | { ok: true; orderedIds: string[] }
  | { ok: false; error: string }

function findRef(
  ref: string,
  milestones: MilestoneRef[]
): MilestoneRef | undefined {
  // Try by id first (exact match — milestone ids are cuids, not UUIDs)
  const byId = milestones.find(m => m.id === ref)
  if (byId) return byId
  // Then try by name (case-insensitive)
  const needle = ref.trim().toLowerCase()
  return milestones.find(m => m.name.toLowerCase() === needle)
}

/** Milestones in current display order (sortOrder asc, stable). */
function sorted(milestones: MilestoneRef[]): MilestoneRef[] {
  return [...milestones].sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Resolve a full list of milestone refs (name or UUID) to ids in the given
 * order. The list must name EVERY milestone in the project exactly once.
 */
export function resolveOrderedIds(
  refs: string[],
  milestones: MilestoneRef[]
): ResolveResult {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const match = findRef(ref, milestones)
    if (!match) {
      return { ok: false, error: `unknown milestone: "${ref}"` }
    }
    if (seen.has(match.id)) {
      return { ok: false, error: `duplicate milestone: "${ref}"` }
    }
    seen.add(match.id)
    ids.push(match.id)
  }
  if (ids.length !== milestones.length) {
    const missing = milestones
      .filter(m => !seen.has(m.id))
      .map(m => m.name)
    return {
      ok: false,
      error: `incomplete order: list every milestone. Missing: ${missing.join(', ')}`,
    }
  }
  return { ok: true, orderedIds: ids }
}

/**
 * Compute the full orderedIds after moving `moveRef` immediately before/after
 * `targetRef` in the project's current order.
 */
export function computeMoveOrder(
  moveRef: string,
  targetRef: string,
  position: 'before' | 'after',
  milestones: MilestoneRef[]
): ResolveResult {
  const move = findRef(moveRef, milestones)
  if (!move) return { ok: false, error: `unknown milestone: "${moveRef}"` }
  const target = findRef(targetRef, milestones)
  if (!target) return { ok: false, error: `unknown milestone: "${targetRef}"` }
  if (move.id === target.id) {
    return { ok: false, error: 'cannot move a milestone relative to itself' }
  }

  const order = sorted(milestones)
    .map(m => m.id)
    .filter(id => id !== move.id)
  const targetIndex = order.indexOf(target.id)
  const insertAt = position === 'before' ? targetIndex : targetIndex + 1
  order.splice(insertAt, 0, move.id)
  return { ok: true, orderedIds: order }
}
