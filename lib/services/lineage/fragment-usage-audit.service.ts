import { sessionRepository } from '@/lib/repositories/session.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  compactEvents,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'
import {
  loadConstitutionText,
  type ConstitutionScope,
} from '@/lib/services/memory/constitution'
import { logger } from '@/lib/logger'
import type { LineageFragmentType } from '@prisma/client'
import type { JudgeFragment } from '@/lib/services/lineage/usage-judge'

/**
 * Audit one session: which injected fragments did the agent actually use?
 * Evidence-gated — the judge sees the fragments + the session's event log and
 * votes used=true ONLY with concrete evidence; everything else stays NULL.
 * Additive vote: never writes false. Best-effort, never throws.
 */
interface AuditTask {
  title: string
  projectId: string
  project: { workspaceId: string }
}

function constitutionScopeOf(task: AuditTask): ConstitutionScope {
  return { projectId: task.projectId, workspaceId: task.project.workspaceId }
}

async function auditSession(sessionId: string, task: AuditTask): Promise<void> {
  const edges = await lineageEdgeRepository.findSessionFragmentEdges(sessionId)
  if (edges.length === 0) return

  const refsByType = new Map<LineageFragmentType, string[]>()
  for (const e of edges) {
    const arr = refsByType.get(e.fragmentType) ?? []
    arr.push(e.fragmentId)
    refsByType.set(e.fragmentType, arr)
  }
  const contentMap = await lineageSourceRepository.contentByType(refsByType)
  const fragments: JudgeFragment[] = edges.map(e => ({
    fragmentType: e.fragmentType,
    fragmentId: e.fragmentId,
    content:
      contentMap.get(`${e.fragmentType}::${e.fragmentId}`) ?? e.fragmentId,
  }))

  const events = await sessionRepository.listEventsForSession(sessionId)
  const eventLog = compactEvents(events as unknown as RawEvent[], {
    maxToolCalls: 200,
  }).text
  if (eventLog.trim().length === 0) return

  // Dynamic import keeps the @ai-sdk/gateway static graph out of this service's
  // (and its callers') jest path — see project_ai_sdk_gateway_jest_trap.
  const { judgeFragmentUsage } =
    await import('@/lib/services/lineage/usage-judge')
  // The constitution the marginal-value gate compares against is the task's
  // PROJECT's own CLAUDE.md / AGENTS.md (LUM-778), not the server's cwd.
  const constitution = await loadConstitutionText(constitutionScopeOf(task))
  const { used, unused } = await judgeFragmentUsage({
    taskTitle: task.title,
    fragments,
    eventLog,
    constitution,
  })
  if (used.length === 0 && unused.length === 0) return

  if (used.length > 0) {
    await lineageEdgeRepository.applyUsageVote(
      sessionId,
      used.map(c => ({
        fragmentType: c.fragmentType as LineageFragmentType,
        fragmentId: c.fragmentId,
      })),
      { mode: 'additive' }
    )
  }
  if (unused.length > 0) {
    await lineageEdgeRepository.applyUnusedVote(
      sessionId,
      unused.map(c => ({
        fragmentType: c.fragmentType as LineageFragmentType,
        fragmentId: c.fragmentId,
      }))
    )
  }
  logger.debug(
    `[lineage.usageAudit] session=${sessionId} used=${used.length} unused=${unused.length}/${edges.length}`
  )
}

export const fragmentUsageAuditService = {
  /**
   * Audit every not-yet-voted session of a task. Fired from task→DONE (and the
   * cron backstop). Idempotent via the voted-session guard. Best-effort.
   */
  async auditForTask(taskId: string): Promise<void> {
    try {
      const task = await taskRepository.getTitleAndStatus(taskId)
      if (!task) return
      const sessions = await sessionRepository.listForTask(taskId)
      // LUM-932 P3: unattached sessions inferred onto the task may span other
      // tasks — judging their usage against this one task's title would cast
      // votes on another task's work. Only explicitly bound sessions vote.
      const ids = sessions.filter(s => !s.inferred).map(s => s.id)
      if (ids.length === 0) return
      const voted = await lineageEdgeRepository.findVotedSessionIds(ids)
      for (const id of ids) {
        if (voted.has(id)) continue
        try {
          await auditSession(id, task)
        } catch (err) {
          logger.error(`[lineage.usageAudit] session=${id} failed`, err)
        }
      }
    } catch (err) {
      logger.error(`[lineage.usageAudit] task=${taskId} failed`, err)
    }
  },

  /**
   * Cron backstop: audit up to `limit` not-yet-voted sessions of DONE tasks.
   * Returns how many sessions it processed (logged, never silently truncated).
   * Drains the dormant production backlog over time.
   */
  async auditDoneTaskSessions(
    limit: number
  ): Promise<{ processed: number; sessionIds: string[] }> {
    const sessionIds =
      await lineageEdgeRepository.listUnvotedSessionIdsForDoneTasks(limit)
    for (const id of sessionIds) {
      try {
        const edges = await lineageEdgeRepository.findSessionFragmentEdges(id)
        if (edges.length === 0) continue
        const task = await sessionRepository.findTaskTitleForSession(id)
        if (!task) continue
        await auditSession(id, task)
      } catch (err) {
        logger.error(`[lineage.usageAudit] cron session=${id} failed`, err)
      }
    }
    return { processed: sessionIds.length, sessionIds }
  },
}
