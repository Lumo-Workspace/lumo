import type { MemoryCategory } from '@prisma/client'

export type Relationship =
  | 'CONTRADICTION'
  | 'REFINEMENT'
  | 'DUPLICATE'
  | 'UNRELATED'
export type ExpectedOp = 'SUPERSEDE' | 'UPDATE' | 'NOOP' | 'ADD'

/** Fixed 1:1 mapping — the relationship label is the source of truth; expectedOp
 * is derived and re-asserted in validation to catch annotation typos. */
export const relationshipToExpectedOp: Record<Relationship, ExpectedOp> = {
  CONTRADICTION: 'SUPERSEDE',
  REFINEMENT: 'UPDATE',
  DUPLICATE: 'NOOP',
  UNRELATED: 'ADD',
}

export interface EvalCase {
  id: string
  category: MemoryCategory
  /** On-file memory content (per-category shape from lib/memory/schemas.ts). */
  existing: unknown
  /** Newly-extracted candidate fact content (same per-category shape). */
  candidate: unknown
  relationship: Relationship
  expectedOp: ExpectedOp
  /** Annotator rationale — never fed to the model. */
  note?: string
}

/** A case has an AR "positive" (the existing memory should be retrieved) unless
 * it is an ADD/UNRELATED case, where the correct behavior is no neighbor. */
export function isPositiveCase(c: EvalCase): boolean {
  return c.relationship !== 'UNRELATED'
}

/** Return a list of human-readable problems with a case ([] = valid). Pass
 * `seenIds` to also flag duplicate ids across a corpus. */
export function validateEvalCase(c: EvalCase, seenIds?: Set<string>): string[] {
  const errs: string[] = []
  if (!c.id) errs.push('(missing id)')
  if (seenIds?.has(c.id)) errs.push(`${c.id}: duplicate id`)
  const want = relationshipToExpectedOp[c.relationship]
  if (c.expectedOp !== want) {
    errs.push(
      `${c.id}: expectedOp ${c.expectedOp} != ${want} for relationship ${c.relationship}`
    )
  }
  if (c.existing === null || typeof c.existing !== 'object') {
    errs.push(`${c.id}: existing not an object`)
  }
  if (c.candidate === null || typeof c.candidate !== 'object') {
    errs.push(`${c.id}: candidate not an object`)
  }
  return errs
}
