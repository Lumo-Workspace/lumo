import {
  ambiguousMilestoneError,
  matchMilestoneRef,
  type MilestoneMatch,
} from '../../../shared/src/milestone-ref'

export interface MilestoneRef {
  id: string
  name: string
  sortOrder: number
  /** LUM-1230: matched as a ref and used to name candidates. */
  slug?: string | null
}

export type ResolveResult =
  | { ok: true; orderedIds: string[] }
  | { ok: false; error: string }

/** id, slug or name (LUM-1230) — see {@link matchMilestoneRef}. */
function findRef(
  ref: string,
  milestones: MilestoneRef[]
): MilestoneMatch<MilestoneRef> {
  return matchMilestoneRef(ref, milestones)
}

function ambiguousError(ref: string, candidates: MilestoneRef[]): string {
  return ambiguousMilestoneError(ref, candidates)
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
    const match = found.milestone
    if (seen.has(match.id)) {
      return { ok: false, error: `duplicate milestone: "${ref}"` }
    }
    seen.add(match.id)
    ids.push(match.id)
  }
  if (ids.length !== milestones.length) {
    const missing = milestones.filter(m => !seen.has(m.id)).map(m => m.name)
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
    return {
      ok: false,
      error: ambiguousError(targetRef, targetFound.candidates),
    }
  }
  const move = moveFound.milestone
  const target = targetFound.milestone
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
