export interface MilestoneRef {
  id: string
  name: string
  sortOrder: number
}

export type ResolveResult =
  | { ok: true; orderedIds: string[] }
  | { ok: false; error: string }

type FindResult =
  | { kind: 'found'; ref: MilestoneRef }
  | { kind: 'ambiguous'; candidates: MilestoneRef[] }
  | { kind: 'not-found' }

function findRef(ref: string, milestones: MilestoneRef[]): FindResult {
  // Try by id first (exact match — milestone ids are cuids, unique).
  const byId = milestones.find(m => m.id === ref)
  if (byId) return { kind: 'found', ref: byId }
  // Then by name (case-insensitive). Names are NOT unique within a project
  // (only slug is), so a name can match more than one milestone.
  const needle = ref.trim().toLowerCase()
  const hits = milestones.filter(m => m.name.toLowerCase() === needle)
  if (hits.length === 0) return { kind: 'not-found' }
  if (hits.length === 1) return { kind: 'found', ref: hits[0]! }
  return { kind: 'ambiguous', candidates: hits }
}

function ambiguousError(ref: string, candidates: MilestoneRef[]): string {
  const ids = candidates.map(c => c.id).join(', ')
  return `ambiguous milestone name "${ref}" matches ${candidates.length} milestones; re-run with the id: ${ids}`
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
    const found = findRef(ref, milestones)
    if (found.kind === 'not-found') {
      return { ok: false, error: `unknown milestone: "${ref}"` }
    }
    if (found.kind === 'ambiguous') {
      return { ok: false, error: ambiguousError(ref, found.candidates) }
    }
    const match = found.ref
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
  const moveFound = findRef(moveRef, milestones)
  if (moveFound.kind === 'not-found') {
    return { ok: false, error: `unknown milestone: "${moveRef}"` }
  }
  if (moveFound.kind === 'ambiguous') {
    return { ok: false, error: ambiguousError(moveRef, moveFound.candidates) }
  }
  const targetFound = findRef(targetRef, milestones)
  if (targetFound.kind === 'not-found') {
    return { ok: false, error: `unknown milestone: "${targetRef}"` }
  }
  if (targetFound.kind === 'ambiguous') {
    return { ok: false, error: ambiguousError(targetRef, targetFound.candidates) }
  }
  const move = moveFound.ref
  const target = targetFound.ref
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
