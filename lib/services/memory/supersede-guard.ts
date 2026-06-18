import { lineageService } from '@/lib/services/lineage.service'

/**
 * A-MEM reuse guardrail (LUM-325). A SUPERSEDE must not silently overwrite a
 * battle-tested memory: if a target is `qualified` by its judged-used track
 * record (judged actually used across enough distinct tasks, LUM-539), we refuse
 * the supersede and leave the existing ACTIVE row in place. Fragments below that
 * bar do NOT block — they're too thin to discriminate, and blocking on them
 * would freeze most of the corpus. A fragment's merge rate no longer enters this.
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
    if (verdict.qualified) guarded.add(id)
  }
  return guarded
}
