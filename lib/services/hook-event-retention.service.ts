import type { Prisma } from '@prisma/client'
import { hookEventRetentionRepository } from '@/lib/repositories/hook-event-retention.repository'
import {
  buildPrunedPayload,
  buildUsedUpPrunedPayload,
  isHookEventRetentionDays,
} from '@/lib/hook-event/retention'
import {
  isCrossingEvidenceReleased,
  recentlyDoneSince,
  usedUpIdleCutoff,
  usedUpKeepTaskIds,
  type CrossingRef,
} from '@/lib/hook-event/used-up'

const DAY_MS = 24 * 60 * 60 * 1000

/** Events read per query. */
const BATCH_SIZE = 500

/**
 * Per-workspace ceiling on events examined in one run, so a first run after
 * enabling retention on a large backlog stays inside the cron's time budget.
 * The daily schedule picks up where it stopped.
 */
const MAX_SCANNED_PER_WORKSPACE = 20_000

export interface PruneWorkspaceResult {
  workspaceId: string
  pruned: number
  /** Expired events kept because a boundary crossing references them. */
  keptForCrossings: number
  /** True when the per-run ceiling stopped the scan early. */
  capped: boolean
}

export interface PruneResult {
  workspaces: PruneWorkspaceResult[]
  pruned: number
}

/**
 * LUM-933: which events one pass may touch. `createdFrom` = only events
 * created at or after the cutoff (the current setting's segment);
 * `createdBefore` = only events created before it (the legacy segment).
 */
interface EventWindow {
  createdFrom?: Date | null
  createdBefore?: Date | null
}

function emptyResult(workspaceId: string): PruneWorkspaceResult {
  return { workspaceId, pruned: 0, keptForCrossings: 0, capped: false }
}

async function pruneWorkspace(
  workspaceId: string,
  retentionDays: number,
  now: Date,
  window: EventWindow = {}
): Promise<PruneWorkspaceResult> {
  const result = emptyResult(workspaceId)
  // A value outside the tiers can only come from a manual DB edit; treat it
  // as "off" rather than guess a window.
  if (!isHookEventRetentionDays(retentionDays)) return result

  const tierBefore = new Date(now.getTime() - retentionDays * DAY_MS)
  const before =
    window.createdBefore && window.createdBefore < tierBefore
      ? window.createdBefore
      : tierBefore
  const prunedPayload = buildPrunedPayload(
    now,
    retentionDays
  ) as unknown as Prisma.InputJsonValue
  // Exemption ②: events of a task that is not DONE yet stay whole — the
  // DONE gate and crossing review may still need them.
  const openTaskIds =
    await hookEventRetentionRepository.findOpenTaskIds(workspaceId)

  let afterId: string | null = null
  let scanned = 0
  for (;;) {
    const ids = await hookEventRetentionRepository.findExpiredEventIds({
      workspaceId,
      before,
      openTaskIds,
      afterId,
      take: BATCH_SIZE,
      createdFrom: window.createdFrom ?? null,
    })
    if (ids.length === 0) break
    scanned += ids.length
    afterId = ids[ids.length - 1]!

    // Exemption ①: an event a boundary crossing points at is the crossing's
    // evidence (detail view, model attribution) — never cleared.
    const referenced = new Set(
      await hookEventRetentionRepository.findCrossingReferencedEventIds(ids)
    )
    const prunable = ids.filter(id => !referenced.has(id))
    result.keptForCrossings += referenced.size
    result.pruned += await hookEventRetentionRepository.prunePayloads(
      prunable,
      prunedPayload,
      now
    )

    if (ids.length < BATCH_SIZE) break
    if (scanned >= MAX_SCANNED_PER_WORKSPACE) {
      result.capped = true
      break
    }
  }
  return result
}

/**
 * LUM-910 — USED_UP mode: drop the raw payload of every event whose work is
 * used up (see lib/hook-event/used-up.ts) and whose grace period has passed.
 */
async function pruneUsedUpWorkspace(
  workspaceId: string,
  now: Date,
  createdFrom: Date | null
): Promise<PruneWorkspaceResult> {
  const result: PruneWorkspaceResult = {
    workspaceId,
    pruned: 0,
    keptForCrossings: 0,
    capped: false,
  }
  const [openTasks, recentlyDone] = await Promise.all([
    hookEventRetentionRepository.findOpenTasksLastActivity(workspaceId),
    hookEventRetentionRepository.findRecentlyDoneTasks(
      workspaceId,
      recentlyDoneSince(now)
    ),
  ])
  const keepTaskIds = usedUpKeepTaskIds({ openTasks, recentlyDone, now })
  const idleBefore = usedUpIdleCutoff(now)
  const prunedPayload = buildUsedUpPrunedPayload(
    now
  ) as unknown as Prisma.InputJsonValue

  let afterId: string | null = null
  let scanned = 0
  for (;;) {
    const ids = await hookEventRetentionRepository.findUsedUpEventIds({
      workspaceId,
      keepTaskIds,
      idleBefore,
      afterId,
      take: BATCH_SIZE,
      createdFrom,
    })
    if (ids.length === 0) break
    scanned += ids.length
    afterId = ids[ids.length - 1]!

    // Crossing evidence waits for the crossing's own disposition + grace.
    const refsByEvent = new Map<string, CrossingRef[]>()
    for (const ref of await hookEventRetentionRepository.findCrossingRefs(
      ids
    )) {
      const list = refsByEvent.get(ref.hookEventId) ?? []
      list.push(ref)
      refsByEvent.set(ref.hookEventId, list)
    }
    const prunable = ids.filter(id => {
      const refs = refsByEvent.get(id)
      if (!refs) return true
      if (isCrossingEvidenceReleased(refs, now)) return true
      result.keptForCrossings++
      return false
    })
    result.pruned += await hookEventRetentionRepository.prunePayloads(
      prunable,
      prunedPayload,
      now
    )

    if (ids.length < BATCH_SIZE) break
    if (scanned >= MAX_SCANNED_PER_WORKSPACE) {
      result.capped = true
      break
    }
  }
  return result
}

function addResults(
  a: PruneWorkspaceResult,
  b: PruneWorkspaceResult
): PruneWorkspaceResult {
  return {
    workspaceId: a.workspaceId,
    pruned: a.pruned + b.pruned,
    keptForCrossings: a.keptForCrossings + b.keptForCrossings,
    capped: a.capped || b.capped,
  }
}

/**
 * LUM-933 — one workspace under its setting and cutoff. Events created at or
 * after `hookEventRetentionSince` (all events when there is no cutoff)
 * follow the current setting; older ones follow the legacy day tier they
 * were stored under, or are never pruned when it is null. A stricter
 * setting therefore never clears data stored before the change.
 */
async function pruneWorkspaceBySetting(
  ws: {
    id: string
    hookEventRetentionMode: 'RETAIN' | 'USED_UP'
    hookEventRetentionDays: number | null
    hookEventRetentionSince: Date | null
    hookEventRetentionLegacyDays: number | null
  },
  now: Date
): Promise<PruneWorkspaceResult> {
  const since = ws.hookEventRetentionSince
  let result = emptyResult(ws.id)
  if (ws.hookEventRetentionMode === 'USED_UP') {
    result = await pruneUsedUpWorkspace(ws.id, now, since)
  } else if (ws.hookEventRetentionDays != null) {
    result = await pruneWorkspace(ws.id, ws.hookEventRetentionDays, now, {
      createdFrom: since,
    })
  }
  if (since && ws.hookEventRetentionLegacyDays != null) {
    result = addResults(
      result,
      await pruneWorkspace(ws.id, ws.hookEventRetentionLegacyDays, now, {
        createdBefore: since,
      })
    )
  }
  return result
}

export const hookEventRetentionService = {
  /**
   * LUM-859 / LUM-910 — daily sweep. USED_UP workspaces drop each event's raw
   * payload 7 days after its work is used up (pruneUsedUpWorkspace). For
   * every RETAIN workspace that set a retention window,
   * replace the payload of each event older than the window with the pruned
   * marker (time + reason). Rows and derived columns (toolName, filePath,
   * usageByModel, turnSummary …) are kept, so cost, active time and collision
   * history are unaffected. Exempt: events a boundary crossing references and
   * events whose task is not DONE. RETAIN workspaces without a window (the
   * default: keep forever) are untouched.
   */
  async pruneExpiredPayloads(now: Date = new Date()): Promise<PruneResult> {
    const workspaces =
      await hookEventRetentionRepository.listWorkspacesWithRetention()
    const results: PruneWorkspaceResult[] = []
    for (const ws of workspaces) {
      results.push(await pruneWorkspaceBySetting(ws, now))
    }
    return {
      workspaces: results,
      pruned: results.reduce((sum, r) => sum + r.pruned, 0),
    }
  },
}
