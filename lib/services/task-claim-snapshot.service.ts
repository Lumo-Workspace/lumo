import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { selectClaim } from '@/lib/services/task-claim'
import { logger } from '@/lib/logger'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'

/**
 * LUM-573 — task-level claim snapshot.
 *
 * The pre-fix claim column read the LATEST session by lastActivityAt
 * (loadLatestRunClaim). When the latest session was an exploration / wrap-up /
 * follow-up run, its runSummary said "only explored, no code changes" while the
 * task was DONE with all criteria PASS — a systematic under-report (claim
 * contradicts verification, the LUM-572 audit's 13→19 矛盾面).
 *
 * The fix (纯 B, no real-time aggregation): the AUTHORITATIVE session is the one
 * carrying a MERGED lineage edge (the DB fact of delivery — it injected context
 * for the work that merged), not the most recent. At DONE/idle the LUM-576
 * retriable worker (and the backfill) synthesize a task-level claim snapshot
 * from that session and FREEZE it to the Task; the read path degrades to a
 * field read of that snapshot.
 *
 * The synthesizer never rewrites the summary text — it only changes WHICH
 * session's summary is shown — so a legitimately negative delivery-session
 * summary stays negative (reverse gate: claim-vs-verification gaps survive),
 * and a task with no material freezes a fail-closed null snapshot.
 */

type ClaimMaterial = { runSummary: string | null; turnSummaries: string[] }

function toMaterial(row: {
  runSummary: string | null
  events: { turnSummary: string | null }[]
}): ClaimMaterial {
  return {
    runSummary: row.runSummary,
    turnSummaries: row.events.map(e => e.turnSummary ?? ''),
  }
}

function hasMaterial(m: ClaimMaterial): boolean {
  return (
    (m.runSummary?.trim().length ?? 0) > 0 ||
    m.turnSummaries.some(t => t.trim().length > 0)
  )
}

export const taskClaimSnapshotService = {
  /**
   * Resolve the authoritative claim material for a task: a session carrying a
   * MERGED lineage edge (preferring the most-recent one that actually has claim
   * material over a more-recent but material-less merged session), falling back
   * to the latest session only when the task has no MERGED-stamped session
   * (pre-merge, or the outcome stamp/cron sweep hasn't run). Returns the chosen
   * session id (provenance) and its material, or `{ sessionId: null, material:
   * null }` when the task has no session at all.
   */
  async resolveClaimMaterial(
    taskId: string
  ): Promise<{ sessionId: string | null; material: ClaimMaterial | null }> {
    const mergedSessionIds =
      await lineageEdgeRepository.findMergedSessionIds(taskId)

    if (mergedSessionIds.length > 0) {
      // Newest-first; take the most-recent merged session that actually HAS
      // claim material. Material-gate is load-bearing: lineage MERGED is an
      // imperfect delivery signal (a do-nothing run can carry a MERGED edge,
      // and the cron may not have summarized the real one yet). An EMPTY merged
      // session must NOT win over a latest session that has a faithful summary —
      // doing so blanks a good claim to null (the LUM-49-class regression). So
      // we only override the latest session when the merged session has
      // something to say; otherwise we fall through to the latest session.
      const rows =
        await sessionRepository.loadRunClaimForSessions(mergedSessionIds)
      const chosen = rows.find(r => hasMaterial(toMaterial(r)))
      if (chosen) return { sessionId: chosen.id, material: toMaterial(chosen) }
    }

    const latest = await sessionRepository.loadLatestRunClaim(taskId)
    if (!latest) return { sessionId: null, material: null }
    return { sessionId: latest.id, material: toMaterial(latest) }
  },

  /**
   * Synthesize and FREEZE the task-level claim snapshot. Best-effort: never
   * throws (it runs inside the run-summary worker's already-swallowed flow and
   * the backfill loop), and is idempotent — a re-run (re-DONE, backfill, cron)
   * resolves the same authoritative claim and overwrites the field.
   *
   * LUM-597 (两存·自述优先): a frozen AGENT self-report (legacy rows from the
   * removed `lumo verify --note`) is authoritative and is NEVER clobbered by
   * the summarizer paraphrase — the DONE-time synthesizer leaves it untouched. The paraphrase still lives on `Session.runSummary` as
   * corroboration; it just doesn't become the claim when the agent spoke.
   */
  async synthesizeForTask(taskId: string): Promise<void> {
    try {
      const existing = await taskRepository.loadClaimSnapshot(taskId)
      if (
        existing?.claimSnapshotSource === 'AGENT' &&
        existing.claimSnapshotAt != null
      ) {
        return
      }
      // LUM-917: with AI-derived content off (or the switch unreadable) no
      // RUN_SUMMARY / DIGEST claim is frozen. The snapshot is still stamped,
      // as "synthesized, no material" (text null, claimSnapshotAt set) — the
      // same write the on-path makes when there is nothing to say — so the
      // read model shows no claim instead of re-deriving one live from the
      // turn summaries, and a verdict judged on an earlier claim goes stale
      // exactly as it would after any re-synthesis.
      if (!(await aiDerivedContentService.isEnabled({ taskId }))) {
        await taskRepository.setClaimSnapshot(taskId, {
          text: null,
          source: null,
          sessionId: null,
          at: new Date(),
        })
        return
      }
      const { sessionId, material } = await this.resolveClaimMaterial(taskId)
      const claim = selectClaim(material)
      await taskRepository.setClaimSnapshot(taskId, {
        text: claim.text,
        source: claim.source,
        sessionId,
        at: new Date(),
      })
    } catch (err) {
      logger.warn(
        `[claim-snapshot] failed to synthesize snapshot for task ${taskId}`,
        err
      )
    }
  },

  /**
   * LUM-573 one-time backfill: (re)synthesize the claim snapshot for every
   * completed task. Unlike the run-summary backfill this is NOT gated on a
   * missing session summary — the tasks the structural 573 bug surfaces are
   * exactly those the LUM-576 backfill already summarized, so their snapshots
   * must be computed from scratch. Idempotent and re-runnable.
   */
  async backfillAll(
    opts: { dryRun?: boolean } = {}
  ): Promise<{ candidateTasks: number; synthesized: number }> {
    const taskIds = await sessionRepository.listCompletedTaskIds()
    if (opts.dryRun) {
      logger.info(
        `[claim-snapshot backfill] dry-run — ${taskIds.length} completed task(s)`
      )
      return { candidateTasks: taskIds.length, synthesized: 0 }
    }
    let synthesized = 0
    for (const taskId of taskIds) {
      await this.synthesizeForTask(taskId)
      synthesized++
    }
    logger.info(
      `[claim-snapshot backfill] done — ${taskIds.length} task(s), ${synthesized} synthesized`
    )
    return { candidateTasks: taskIds.length, synthesized }
  },
}
