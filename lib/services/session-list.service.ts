import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  parseEvidence,
  type AttributionConfidenceName,
  type AttributionSourceName,
  type EvidenceView,
} from '@/lib/attribution/run-attribution'

export interface SessionListRow {
  id: string
  cwd: string | null
  lastActivityAt: string
  eventCount: number
  subagentCount: number
  taskCount: number
}

export interface SessionAttributionView {
  segments: {
    taskIdentifier: string
    source: AttributionSourceName
    confidence: AttributionConfidenceName
    fromTurn: number
    toTurn: number
    evidence: EvidenceView[]
  }[]
  subagents: {
    sessionId: string
    agentType: string | null
    tasks: {
      taskIdentifier: string
      source: AttributionSourceName
      confidence: AttributionConfidenceName
    }[]
  }[]
  /** No segment for the session itself — its work is unattributed. */
  unattributed: boolean
  approximate: boolean
}

export const sessionListService = {
  async listForUser(clerkId: string): Promise<SessionListRow[]> {
    const sessions = await sessionRepository.listForClerkUser(clerkId)
    const families = await sessionRepository.summarizeFamilies(
      sessions.map(s => s.id)
    )
    return sessions.map(s => {
      const family = families.get(s.id)
      return {
        id: s.id,
        cwd: s.cwd,
        lastActivityAt: s.lastActivityAt.toISOString(),
        eventCount: s.eventCount,
        subagentCount: family?.subagentCount ?? 0,
        taskCount: family?.taskIds.length ?? 0,
      }
    })
  },

  /**
   * Not ownership-scoped: callers must check access first (sessionDetailService.getForViewer / findForMemberWithBinding).
   */
  async getAttribution(sessionId: string): Promise<SessionAttributionView> {
    const [rows, children, binding] = await Promise.all([
      sessionRepository.listFamilyAttribution(sessionId),
      sessionRepository.listChildSessions(sessionId),
      sessionRepository.findRootBinding(sessionId),
    ])
    const stored = rows
      .filter(r => r.sessionId === sessionId)
      .sort((a, b) => a.fromTurn - b.fromTurn)
      .map(r => ({
        taskIdentifier: r.taskIdentifier,
        source: r.source,
        confidence: r.confidence,
        fromTurn: r.fromTurn,
        toTurn: r.toTurn,
        evidence: parseEvidence(r.evidence),
      }))
    // A bound root without segment rows yet is still explicitly on its task.
    const segments: SessionAttributionView['segments'] =
      stored.length === 0 && binding
        ? [
            {
              taskIdentifier: binding.taskIdentifier,
              source:
                binding.bindingSource === 'INHERITED'
                  ? 'INHERITED'
                  : 'SESSION_ATTACH',
              confidence: 'EXPLICIT',
              fromTurn: 0,
              toTurn: 0,
              evidence: [],
            },
          ]
        : stored
    const subagents = children.map(child => ({
      sessionId: child.id,
      agentType: child.agentType,
      tasks: rows
        .filter(r => r.sessionId === child.id)
        .map(r => ({
          taskIdentifier: r.taskIdentifier,
          source: r.source,
          confidence: r.confidence,
        })),
    }))
    return {
      segments,
      subagents,
      unattributed: segments.length === 0,
      approximate: rows.some(r => r.source === 'INFERRED'),
    }
  },
}
