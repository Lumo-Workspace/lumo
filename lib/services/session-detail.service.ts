import { sessionRepository } from '@/lib/repositories/session.repository'
import { sessionRawRecordRepository } from '@/lib/repositories/session-raw-record.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  sessionListService,
  type SessionAttributionView,
} from '@/lib/services/session-list.service'
import { lookupClerkProfiles } from '@/lib/utils/clerk-helpers'
import { logger } from '@/lib/logger'

/** A session's place in its workspace — all the access rule looks at. */
export interface SessionAccessScope {
  workspaceId: string
  workspaceMemberId: string
}

/** The viewer's membership in the session's workspace. */
export interface SessionDetailViewerMembership {
  id: string
  workspaceId: string
  role: string
}

/**
 * LUM-946: who may open /sessions/[id] — the session's own member, or an
 * OWNER of the session's own workspace (the LUM-944 raw-record rule). A
 * membership in any other workspace never counts.
 */
export function canViewSessionDetail(
  session: SessionAccessScope,
  viewer: SessionDetailViewerMembership | null
): boolean {
  if (!viewer || viewer.workspaceId !== session.workspaceId) return false
  return session.workspaceMemberId === viewer.id || viewer.role === 'OWNER'
}

export interface SessionDetailForViewer {
  id: string
  cwd: string | null
  startedAt: Date
  lastActivityAt: Date
  eventCount: number
  /** JSON; its shape depends on summaryType. */
  summary: unknown
  summaryType: string | null
  summaryGeneratedAt: Date | null
  summaryEventCount: number | null
  workspaceSlug: string
  /** False when an OWNER is viewing another member's session. */
  isOwnSession: boolean
  /** The session member's display name when it is not the viewer's; null if unknown. */
  ownerName: string | null
  rawEvents: Awaited<ReturnType<typeof sessionRepository.listEventsForSession>>
  attribution: SessionAttributionView
}

async function resolveOwnerName(clerkId: string): Promise<string | null> {
  try {
    const profile = (await lookupClerkProfiles([clerkId])).get(clerkId)
    return profile?.name ?? profile?.email ?? null
  } catch (err) {
    logger.warn('[session-detail] owner name lookup failed', { error: err })
    return null
  }
}

export const sessionDetailService = {
  /**
   * The /sessions/[id] page data, or null when the session does not exist or
   * the viewer may not see it — the page answers both with 404 so ids can't be
   * enumerated. A subagent's page shows its parent family's attribution, so
   * the parent must pass the same rule.
   */
  async getForViewer(
    sessionId: string,
    clerkId: string
  ): Promise<SessionDetailForViewer | null> {
    const session = await sessionRepository.findDetailById(sessionId)
    if (!session) return null

    const viewer = await memberRepository.findRoleInWorkspace(
      session.workspaceId,
      clerkId
    )
    if (!canViewSessionDetail(session, viewer)) return null

    const rootId = session.parentSessionId ?? session.id
    if (session.parentSessionId) {
      const parent = await sessionRawRecordRepository.findSessionOwner(
        session.parentSessionId
      )
      if (parent && !canViewSessionDetail(parent, viewer)) return null
    }

    const isOwnSession = session.workspaceMemberId === viewer?.id
    const [rawEvents, attribution, ownerName] = await Promise.all([
      sessionRepository.listEventsForSession(session.id),
      sessionListService.getAttribution(rootId),
      isOwnSession ? null : resolveOwnerName(session.member.clerkId),
    ])

    return {
      id: session.id,
      cwd: session.cwd,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      eventCount: session.eventCount,
      summary: session.summary,
      summaryType: session.summaryType,
      summaryGeneratedAt: session.summaryGeneratedAt,
      summaryEventCount: session.summaryEventCount,
      workspaceSlug: session.workspace.slug,
      isOwnSession,
      ownerName,
      rawEvents,
      attribution,
    }
  },
}
