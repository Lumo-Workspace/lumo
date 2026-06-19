import { unlinkSync } from 'node:fs'
import { resolveMemoryDir } from './claude-memory-dir'
import { applySync, type SyncBundle } from './apply-sync'
import { runAnchorCheck } from './anchor-staleness'
import { collectUpsyncCandidates, projectMemoriesEndpoint } from './upsync'
import {
  readThrottleState,
  writeThrottleState,
  isThrottled,
  throttleHours,
} from './sync-throttle'

/**
 * LUM-551 — best-effort auto-triggers for team-memory sync/push.
 *
 * Both orchestrators are CLI-local, total `try/catch` (never throw), and quiet.
 * They reuse the existing sync/push/anchor primitives rather than adding a
 * parallel path. `LUMO_DISABLE_MEMORY_AUTO` turns both off wholesale.
 */
function autoDisabled(): boolean {
  return !!process.env.LUMO_DISABLE_MEMORY_AUTO
}

export interface AutoDownsyncInput {
  cwd: string
  base: string
  token: string
  projectId: string
  now: Date
  /** Override the memory dir (tests). Defaults to the cwd-derived dir. */
  dir?: string
}

export interface AutoDownsyncResult {
  skipped?: 'disabled' | 'throttled'
  error?: string
  added?: number
  updated?: number
  removed?: number
  anchorCandidates?: number
}

/** Fetch the team-memory sync bundle for a project. Throws on a non-2xx. */
async function fetchSyncBundle(
  base: string,
  token: string,
  projectId: string
): Promise<SyncBundle> {
  const res = await fetch(
    `${base}/api/projects/${encodeURIComponent(projectId)}/memories/sync-bundle`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`sync-bundle HTTP ${res.status}`)
  const { bundle } = (await res.json()) as { bundle: SyncBundle }
  return bundle
}

/**
 * Attach-triggered best-effort downsync (LUM-551). Throttle-gated; swallows all
 * errors into `{ error }`; NEVER throws. On a real sync it also runs the P4b
 * anchor check (advisory) and records the throttle timestamp.
 */
export async function autoDownsyncOnAttach(
  input: AutoDownsyncInput
): Promise<AutoDownsyncResult> {
  if (autoDisabled()) return { skipped: 'disabled' }
  try {
    const dir = resolveMemoryDir(input.cwd, undefined, input.dir)
    const state = readThrottleState(dir)
    if (isThrottled(state, input.now, throttleHours(), input.projectId)) {
      return { skipped: 'throttled' }
    }
    const bundle = await fetchSyncBundle(
      input.base,
      input.token,
      input.projectId
    )
    const summary = applySync(dir, bundle)
    let anchorCandidates = 0
    try {
      const { candidates, report } = await runAnchorCheck({
        cwd: input.cwd,
        base: input.base,
        token: input.token,
        projectId: input.projectId,
        entries: bundle.entries,
      })
      if (report.ok) anchorCandidates = candidates.length
    } catch {
      // anchor detection is advisory — never fail the sync over it
    }
    writeThrottleState(
      dir,
      { lastSyncAt: input.now.toISOString(), projectId: input.projectId },
      input.now
    )
    return {
      added: summary.added.length,
      updated: summary.updated.length,
      removed: summary.removed.length,
      anchorCandidates,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export interface AutoUpsyncInput {
  cwd: string
  base: string
  token: string
  /** Lazily resolve the project — only called when the outbox is non-empty. */
  resolveProjectId: () => Promise<string | null>
  dir?: string
}

export interface AutoUpsyncResult {
  skipped?: 'disabled' | 'empty'
  pushed?: number
  error?: string
}

/**
 * Lifecycle-hook upsync drain (LUM-551). Outbox-empty fast path FIRST (no
 * network); only a non-empty outbox resolves the project and pushes. Reuses the
 * `memory-push` semantics (POST → unlink on 2xx). NEVER throws.
 */
export async function autoUpsyncOnDrain(
  input: AutoUpsyncInput
): Promise<AutoUpsyncResult> {
  if (autoDisabled()) return { skipped: 'disabled' }
  try {
    const dir = resolveMemoryDir(input.cwd, undefined, input.dir)
    const candidates = collectUpsyncCandidates(dir)
    if (candidates.length === 0) return { skipped: 'empty' }
    const projectId = await input.resolveProjectId()
    if (!projectId) return { error: 'no resolvable project for upsync' }
    const url = projectMemoriesEndpoint(input.base, projectId)
    let pushed = 0
    for (const c of candidates) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category: c.category, content: c.content }),
      })
      if (!res.ok) continue
      try {
        unlinkSync(c.file)
      } catch {
        // best-effort cleanup; a re-push is idempotent via reconcile-on-write
      }
      pushed++
    }
    return { pushed }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
