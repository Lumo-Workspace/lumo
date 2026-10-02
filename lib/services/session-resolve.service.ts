import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  hasPendingChildBash,
  matchPendingLumoCommand,
} from '@/lib/session/resolve-caller'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

/** How far back a pending PreToolUse may be to count as "the current call". */
const LOOKBACK_MS = 120_000

export type CallerResolution = {
  sessionId: string
  /**
   * `unmatched`: no pending command matched, but a subagent is mid-command —
   * the call may be that subagent's; `sessionId` is the parent as a fallback.
   */
  resolution: 'parent' | 'child' | 'ambiguous' | 'unmatched'
}

export const sessionResolveService = {
  /**
   * LUM-932: map a CLI call made with CLAUDE_CODE_SESSION_ID=<parent> to the
   * session that actually issued it — the parent itself or one of its
   * subagent child sessions. Never throws for "not found": an unknown or
   * foreign session, no children, or no match all resolve to the given id.
   */
  async resolveCaller(input: {
    identity: VerifyApiKeyResult
    sessionId: string
    argv: string[]
    now?: Date
  }): Promise<CallerResolution> {
    const parentId = input.sessionId
    const fallback = { sessionId: parentId, resolution: 'parent' as const }
    const memberId = await miscRepository.findMemberIdForHook(
      input.identity.user.id,
      input.identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Not a workspace member'), { status: 403 })
    }
    const owned = await sessionRepository.findForMemberWithBinding(
      parentId,
      memberId
    )
    if (!owned) return fallback
    const childIds = await sessionRepository.listChildIds(parentId)
    if (childIds.length === 0) return fallback
    const now = input.now ?? new Date()
    const events = await hookEventRepository.findRecentBashToolEventsInSessions(
      [parentId, ...childIds],
      new Date(now.getTime() - LOOKBACK_MS)
    )
    const match = matchPendingLumoCommand(events, input.argv)
    if (match.kind === 'one') {
      return {
        sessionId: match.sessionId,
        resolution: match.sessionId === parentId ? 'parent' : 'child',
      }
    }
    if (match.kind === 'ambiguous')
      return { sessionId: parentId, resolution: 'ambiguous' }
    if (hasPendingChildBash(events, parentId))
      return { sessionId: parentId, resolution: 'unmatched' }
    return fallback
  },
}
