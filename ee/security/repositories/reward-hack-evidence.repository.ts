/**
 * LUM-1234 — read-only queries behind the web evidence view of a
 * REWARD_HACK finding: the finding with its scan's task and workspace, the
 * cited sessions' access scope, the cited events, and the user prompts that
 * opened the cited turns. Web only — `findByIdForReview` (PR sync) never
 * loads `evidence`. Every event query is scoped to the workspace.
 */
import type { HookEventType } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { RhEvent } from '@/ee/security/security-scan/reward-hack-input'

export interface RhEvidenceFindingRow {
  id: string
  kind: string
  title: string
  /** JSON `{ eventIds: string[], sessionIds: string[] }`. */
  evidence: string
  scan: { taskId: string | null; workspaceId: string }
}

export interface RhEvidenceSessionScope {
  id: string
  workspaceId: string
  workspaceMemberId: string
  parentSessionId: string | null
}

/** Event types a cited step can be (the transcript the judge read). */
const RH_EVIDENCE_EVENT_TYPES: HookEventType[] = [
  'USER_PROMPT_SUBMIT',
  'POST_TOOL_USE',
  'STOP',
]

/** Prompts read to find the turn openers — newest first, bounded. */
export const RH_EVIDENCE_PROMPT_SCAN_LIMIT = 200

const EVENT_SELECT = {
  id: true,
  sessionId: true,
  type: true,
  toolName: true,
  payload: true,
  createdAt: true,
} as const

function toRhEvents(
  rows: Array<{
    id: string
    sessionId: string | null
    type: HookEventType
    toolName: string | null
    payload: unknown
    createdAt: Date
  }>
): RhEvent[] {
  const out: RhEvent[] = []
  for (const r of rows) {
    if (!r.sessionId) continue
    out.push({
      id: r.id,
      sessionId: r.sessionId,
      type: r.type,
      toolName: r.toolName,
      payload: r.payload,
      createdAt: r.createdAt,
    })
  }
  return out
}

export const rewardHackEvidenceRepository = {
  async findFinding(findingId: string): Promise<RhEvidenceFindingRow | null> {
    return prisma.prSecurityFinding.findUnique({
      where: { id: findingId },
      select: {
        id: true,
        kind: true,
        title: true,
        evidence: true,
        scan: { select: { taskId: true, workspaceId: true } },
      },
    })
  },

  /** The sessions (and any parents) among `ids` that are in the workspace. */
  async findSessionScopes(
    workspaceId: string,
    ids: string[]
  ): Promise<RhEvidenceSessionScope[]> {
    if (ids.length === 0) return []
    return prisma.session.findMany({
      where: { id: { in: ids }, workspaceId },
      select: {
        id: true,
        workspaceId: true,
        workspaceMemberId: true,
        parentSessionId: true,
      },
    })
  },

  /** The cited events that belong to one of `sessionIds` in the workspace. */
  async findEvents(
    workspaceId: string,
    sessionIds: string[],
    eventIds: string[]
  ): Promise<RhEvent[]> {
    if (sessionIds.length === 0 || eventIds.length === 0) return []
    const rows = await prisma.hookEvent.findMany({
      where: {
        id: { in: eventIds },
        workspaceId,
        sessionId: { in: sessionIds },
        type: { in: RH_EVIDENCE_EVENT_TYPES },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: EVENT_SELECT,
    })
    return toRhEvents(rows)
  },

  /**
   * User prompts of `sessionIds` at or before `before`, newest first and
   * bounded — the caller picks, per cited step, the prompt that opened its
   * turn.
   */
  async findPromptsUpTo(
    workspaceId: string,
    sessionIds: string[],
    before: Date
  ): Promise<RhEvent[]> {
    if (sessionIds.length === 0) return []
    const rows = await prisma.hookEvent.findMany({
      where: {
        workspaceId,
        sessionId: { in: sessionIds },
        type: 'USER_PROMPT_SUBMIT',
        createdAt: { lte: before },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RH_EVIDENCE_PROMPT_SCAN_LIMIT,
      select: EVENT_SELECT,
    })
    return toRhEvents(rows)
  },
}
