import {
  readOwned,
  writeEntry,
  removeEntry,
  readIndex,
  writeIndex,
  writeTeamIndex,
  removeTeamIndex,
} from './local-memory-store'
import { diffSync } from './memory-reconcile'
import {
  upsertBlock,
  removeBlock,
  blockLines,
  teamIndexFile,
} from './managed-block'
import { clearThrottleState } from './sync-throttle'

/**
 * One downsync entry as it arrives over the wire (server's ShapedSyncEntry).
 * Defined CLI-side because the CLI build (cli/tsconfig) cannot reach the main
 * app's `lib/`; the CLI only talks to the server over HTTP. The server may send
 * extra fields (slug/category/scope/description) — the CLI uses only these.
 */
export interface SyncBundleEntry {
  id: string
  relPath: string
  frontmatter: string
  body: string
  contentHash: string
  indexLine: string
}

export interface SyncBundle {
  projectId: string
  entries: SyncBundleEntry[]
}

export interface SyncSummary {
  added: string[]
  updated: string[]
  removed: string[]
  skippedDrift: string[]
  /** true when nothing was (or would be) written — used to confirm idempotency. */
  noop: boolean
}

export interface ApplyOptions {
  dryRun?: boolean | undefined
  clean?: boolean | undefined
}

/**
 * Apply a downsync bundle to the local memory dir. Owns only `root/team/*.md`
 * (including the full index `team/INDEX.md`) and the MEMORY.md managed block;
 * dev-authored files and out-of-block index content are never touched. The
 * block holds a pointer to `team/INDEX.md` plus the top entries within a byte
 * budget, so MEMORY.md stays inside Claude Code's load limit (LUM-1288).
 * `--clean` removes all owned files, the index and the block; `--dry-run`
 * computes the plan and writes nothing.
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
      removeTeamIndex(root)
      writeIndex(root, removeBlock(readIndex(root)))
      clearThrottleState(root)
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
  // The full list goes to team/INDEX.md; MEMORY.md keeps a budgeted pointer.
  const lines = bundle.entries.map(e => e.indexLine)
  if (lines.length > 0) writeTeamIndex(root, teamIndexFile(lines))
  else removeTeamIndex(root)
  writeIndex(root, upsertBlock(readIndex(root), blockLines(lines)))
  return summary
}
