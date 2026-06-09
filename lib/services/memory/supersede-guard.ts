import { lineageService } from '@/lib/services/lineage.service'

/**
 * A-MEM reuse guardrail (LUM-325). A SUPERSEDE must not silently overwrite a
 * battle-tested memory: if a target carries a strong `usage` trust verdict (the
 * agent voted it actually used across ≥ the threshold of resolved tasks), we
 * refuse the supersede and leave the existing ACTIVE row in place. Weak
 * `presence` signals (merely co-loaded) do NOT block — they're too noisy to
 * discriminate, and blocking on them would freeze most of the corpus.
 *
 * Returns the subset of `targetIds` that are guarded (the caller must skip
 * their SUPERSEDE). Best-effort: `fragmentTrustForMemories` degrades to `{}` on
 * any failure, so a lineage hiccup never blocks a legitimate supersede.
 */
export async function resolveGuardedSupersedeIds(
  targetIds: string[]
): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set()
  const trust = await lineageService.fragmentTrustForMemories(targetIds)
  const guarded = new Set<string>()
  for (const [id, verdict] of Object.entries(trust)) {
    if (verdict.kind === 'usage') guarded.add(id)
  }
  return guarded
}
