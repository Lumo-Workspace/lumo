/**
 * PURE — LUM-1127 follow-up #3: every fingerprint a review thread stands for.
 * A thread keeps its original fingerprint (dispositions and learnings look it
 * up) and records the ones it was carried to when a later review relabelled
 * the same issue (`aliasFingerprints`, oldest first).
 */
export function threadFingerprints(row: {
  fingerprint: string
  aliasFingerprints?: readonly string[] | undefined
}): string[] {
  return [row.fingerprint, ...(row.aliasFingerprints ?? [])]
}
