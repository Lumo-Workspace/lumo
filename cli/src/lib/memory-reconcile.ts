import type { OwnedLocalFile } from '@/cli/src/lib/local-memory-store'

export interface BundleEntryRef {
  id: string
  contentHash: string
}

export interface SyncPlan {
  add: BundleEntryRef[]
  update: BundleEntryRef[]
  remove: string[]
  /** owned files edited locally (diskHash ≠ frontmatter hash) — never overwritten. */
  skipDrift: string[]
}

/**
 * Pure reconcile: given the owned local files and the server bundle, classify
 * each into add / update / remove / skipDrift. Idempotent — identical state
 * yields empty add/update/remove. A locally-edited owned file (drift) is never
 * an update or remove; it is reported as skipDrift so the dev's edit survives
 * (and becomes a P3 upsync candidate).
 */
export function diffSync(
  owned: OwnedLocalFile[],
  bundle: BundleEntryRef[]
): SyncPlan {
  const ownedById = new Map(owned.map(o => [o.id, o]))
  const bundleById = new Map(bundle.map(b => [b.id, b]))

  const add = bundle.filter(b => !ownedById.has(b.id))
  const remove: string[] = []
  const update: BundleEntryRef[] = []
  const skipDrift: string[] = []

  for (const o of owned) {
    const b = bundleById.get(o.id)
    if (o.diskHash !== o.contentHash) {
      // locally edited → protect it regardless of whether the server changed
      skipDrift.push(o.id)
      continue
    }
    if (!b) {
      remove.push(o.id)
      continue
    }
    if (b.contentHash !== o.contentHash) update.push(b)
  }

  return { add, update, remove, skipDrift }
}
