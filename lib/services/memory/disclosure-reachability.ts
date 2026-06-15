export interface FragmentKey {
  fragmentType: string
  fragmentId: string
}

/** Key a fragment for set membership (matches the reachable-set keying). */
export function fragmentReachKey(f: FragmentKey): string {
  return `${f.fragmentType}:${f.fragmentId}`
}

/**
 * Return the merged-contributing fragments that the new disclosure model would
 * make unreachable (LUM-500 invariant guard). `reachable` is the set of
 * `fragmentType:fragmentId` keys the new model still surfaces (Tier-1 full ∪
 * Tier-2 index/manifest ∪ browsable pointer). Empty result = invariant holds.
 */
export function unreachableMergedFragments(
  merged: FragmentKey[],
  reachable: Set<string>
): FragmentKey[] {
  return merged.filter(f => !reachable.has(fragmentReachKey(f)))
}
