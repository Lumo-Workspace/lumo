import { milestoneMemoryEdgeRepository } from '@/lib/repositories/milestone-memory-edge.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  compactEvents,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'
import {
  loadConstitutionText,
  type ConstitutionScope,
} from '@/lib/services/memory/constitution'
import { logger } from '@/lib/logger'
import type { JudgeFragment } from '@/lib/services/lineage/usage-judge'

/**
 * Audit one steward session: of the prior-milestone memories injected into it,
 * which did the agent actually use? Evidence-gated — reuses the SAME
 * `judgeFragmentUsage` as the task-flywheel usage audit (LUM-314): the judge
 * sees the injected memories + the session's compacted event log and votes
 * used=true ONLY with concrete evidence, used=false when it saw substantive
 * related work that ignored the memory, and abstains (leaves NULL) otherwise.
 * Best-effort, never throws.
 */
async function auditSession(
  sessionId: string,
  milestoneName: string,
  scope: ConstitutionScope
): Promise<void> {
  const edges = await milestoneMemoryEdgeRepository.findSessionEdges(sessionId)
  if (edges.length === 0) return

  const memoryIds = edges.map(e => e.memoryId)
  const contentById = await memoryRepository.findContentByIds(memoryIds)
  const fragments: JudgeFragment[] = edges.map(e => ({
    fragmentType: 'MEMORY',
    fragmentId: e.memoryId,
    content: contentById.get(e.memoryId) ?? e.memoryId,
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
  // The milestone's PROJECT's own CLAUDE.md / AGENTS.md (LUM-778).
  const constitution = await loadConstitutionText(scope)
  const { used, unused } = await judgeFragmentUsage({
    // The steward session is milestone-bound, not task-bound; the milestone
    // name is the closest "what was this session working on" the judge needs.
    taskTitle: milestoneName,
    fragments,
    eventLog,
    constitution,
  })
  if (used.length === 0 && unused.length === 0) return

  if (used.length > 0) {
    await milestoneMemoryEdgeRepository.applyUsageVote(
      sessionId,
      used.map(c => c.fragmentId)
    )
  }
  if (unused.length > 0) {
    await milestoneMemoryEdgeRepository.applyUnusedVote(
      sessionId,
      unused.map(c => c.fragmentId)
    )
  }
  logger.debug(
    `[lineage.milestoneMemoryUsage] session=${sessionId} used=${used.length} unused=${unused.length}/${edges.length}`
  )
}

export const milestoneMemoryUsageAuditService = {
  /**
   * Audit every not-yet-voted steward session that consumed prior-milestone
   * memory for this (now-closing) milestone. The milestone-close analog of the
   * task→DONE trigger: task→DONE audits a task's sessions; milestone-close
   * audits the milestone's steward sessions. Idempotent via the voted-session
   * guard. Best-effort — owns its errors, never throws, so a judge failure
   * can't fail the retro / distillation that runs alongside it at close.
   */
  async auditForMilestoneClose(milestoneId: string): Promise<void> {
    try {
      const milestone = await milestoneRepository.findById(milestoneId)
      if (!milestone) return
      const project = await projectRepository.findWorkspaceId(
        milestone.projectId
      )
      if (!project) return
      const scope: ConstitutionScope = {
        projectId: milestone.projectId,
        workspaceId: project.workspaceId,
      }
      const sessionIds =
        await milestoneMemoryEdgeRepository.listConsumerSessionIds(milestoneId)
      if (sessionIds.length === 0) return
      const voted =
        await milestoneMemoryEdgeRepository.findVotedSessionIds(sessionIds)
      for (const id of sessionIds) {
        if (voted.has(id)) continue
        try {
          await auditSession(id, milestone.name, scope)
        } catch (err) {
          logger.error(
            `[lineage.milestoneMemoryUsage] session=${id} failed`,
            err
          )
        }
      }
    } catch (err) {
      logger.error(
        `[lineage.milestoneMemoryUsage] milestone=${milestoneId} failed`,
        err
      )
    }
  },
}
