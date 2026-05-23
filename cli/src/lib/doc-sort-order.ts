/**
 * Compute the sortOrder to assign to a new/relocated doc so it lands at the
 * end of its sibling list. Empty siblings → 0. Otherwise max(sortOrder) + 1.
 *
 * The "siblings" passed in MUST be the docs already under the target parent
 * (or under root). The caller filters this out of the GET /api/documents
 * payload before calling — keeping this function pure makes it cheap to
 * unit-test in the future.
 */
export function pickNextSortOrder(siblings: { sortOrder: number }[]): number {
  if (siblings.length === 0) return 0
  let max = siblings[0]!.sortOrder
  for (let i = 1; i < siblings.length; i++) {
    const v = siblings[i]!.sortOrder
    if (v > max) max = v
  }
  return max + 1
}
