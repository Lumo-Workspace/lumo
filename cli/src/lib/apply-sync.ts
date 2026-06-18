import type { SyncBundle } from '@/lib/api-client/memories'
import {
  readOwned,
  writeEntry,
  removeEntry,
  readIndex,
  writeIndex,
} from '@/cli/src/lib/local-memory-store'
import { diffSync } from '@/cli/src/lib/memory-reconcile'
import { upsertBlock, removeBlock } from '@/cli/src/lib/managed-block'

export interface SyncSummary {
  added: string[]
  updated: string[]
  removed: string[]
  skippedDrift: string[]
  /** true when nothing was (or would be) written — used to confirm idempotency. */
  noop: boolean
}

export interface ApplyOptions {
  dryRun?: boolean
  clean?: boolean
}

/**
 * Apply a downsync bundle to the local memory dir. Owns only `root/team/*.md`
 * and the MEMORY.md managed block; dev-authored files and out-of-block index
 * content are never touched. `--clean` removes all owned files + the block;
 * `--dry-run` computes the plan and writes nothing.
 */
export function applySync(
  root: string,
  bundle: SyncBundle,
  opts: ApplyOptions = {}
): SyncSummary {
  if (opts.clean) {
    const owned = readOwned(root)
    if (!opts.dryRun) {
      for (const o of owned) removeEntry(root, o.id)
      writeIndex(root, removeBlock(readIndex(root)))
    }
    return {
      added: [],
      updated: [],
      removed: owned.map(o => o.id),
      skippedDrift: [],
      noop: owned.length === 0,
    }
  }

  const owned = readOwned(root)
  const plan = diffSync(
    owned,
    bundle.entries.map(e => ({ id: e.id, contentHash: e.contentHash }))
  )
  const byId = new Map(bundle.entries.map(e => [e.id, e]))

  const summary: SyncSummary = {
    added: plan.add.map(a => a.id),
    updated: plan.update.map(u => u.id),
    removed: plan.remove,
    skippedDrift: plan.skipDrift,
    noop:
      plan.add.length === 0 &&
      plan.update.length === 0 &&
      plan.remove.length === 0,
  }
  if (opts.dryRun) return summary

  for (const a of plan.add) {
    const e = byId.get(a.id)!
    writeEntry(root, e)
  }
  for (const u of plan.update) {
    const e = byId.get(u.id)!
    writeEntry(root, e)
  }
  for (const id of plan.remove) removeEntry(root, id)

  // Index = every bundle entry's line (added/updated/unchanged/drift-skipped all
  // still exist locally); removed ids are absent from the bundle so they drop out.
  writeIndex(
    root,
    upsertBlock(
      readIndex(root),
      bundle.entries.map(e => e.indexLine)
    )
  )
  return summary
}
