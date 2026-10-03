import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { ModelUsage } from '@/lib/repositories/session.repository'

/**
 * LUM-932 `lumo usage resync`: persistence for replacing a session family's
 * inflated historical usage with exact deduped figures. Pure data access —
 * the eligibility rules and the correction plan live in
 * lib/services/usage-resync.service.ts.
 */

/** Event types whose `usageByModel` holds a per-turn / per-step delta. */
export const RESYNC_EVENT_TYPES = [
  'STOP',
  'STOP_FAILURE',
  'POST_TOOL_BATCH',
  'SUBAGENT_STOP',
] as const

/**
 * Writes per family run in one transaction. Longer than the attribution
 * retag's 15s (RETAG_TX_OPTIONS): a long session can carry thousands of
 * per-step rows. Rows with an identical scaled value share one updateMany.
 */
const RESYNC_TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 } as const

/** Group rows by their (serialized) new value so each group is one write. */
function groupRowsByValue(
  rows: SessionResyncWrite['rows']
): Array<{ ids: string[]; usageByModel: Record<string, ModelUsage> }> {
  const groups = new Map<
    string,
    { ids: string[]; usageByModel: Record<string, ModelUsage> }
  >()
  for (const r of rows) {
    const key = JSON.stringify(r.usageByModel)
    const g = groups.get(key)
    if (g) g.ids.push(r.id)
    else groups.set(key, { ids: [r.id], usageByModel: r.usageByModel })
  }
  return [...groups.values()]
}

export interface ResyncSessionRow {
  id: string
  workspaceId: string
  lastActivityAt: Date
  usageResyncedAt: Date | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  usageByModel: Record<string, ModelUsage> | null
  liveUsageByModel: Record<string, ModelUsage> | null
}

export interface ResyncEventRow {
  id: string
  sessionId: string
  usageByModel: Record<string, ModelUsage>
}

export interface ResyncSessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  usageByModel: Record<string, ModelUsage>
}

export interface SessionResyncWrite {
  sessionId: string
  /** Null = verified unchanged: only `usageResyncedAt` is set (family root). */
  usage: ResyncSessionUsage | null
  rows: Array<{ id: string; usageByModel: Record<string, ModelUsage> }>
  audit: { before: unknown; after: unknown; factors: unknown; rows: unknown }
}

const SESSION_SELECT = {
  id: true,
  workspaceId: true,
  lastActivityAt: true,
  usageResyncedAt: true,
  inputTokens: true,
  outputTokens: true,
  cacheReadTokens: true,
  cacheCreationTokens: true,
  usageByModel: true,
  liveUsageByModel: true,
} as const

const asUsageMap = (v: unknown): Record<string, ModelUsage> | null =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, ModelUsage>)
    : null

function toRow(r: {
  id: string
  workspaceId: string
  lastActivityAt: Date
  usageResyncedAt: Date | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  usageByModel: unknown
  liveUsageByModel: unknown
}): ResyncSessionRow {
  return {
    ...r,
    usageByModel: asUsageMap(r.usageByModel),
    liveUsageByModel: asUsageMap(r.liveUsageByModel),
  }
}

const json = (v: unknown) => v as Prisma.InputJsonValue

export const usageResyncRepository = {
  /**
   * The root session `rootId` owned by `workspaceMemberId` (top-level only)
   * plus those of `childIds` that are its children under the same member.
   * Null when the root is missing, foreign, or itself a child.
   */
  async findFamilyForMember(
    rootId: string,
    workspaceMemberId: string,
    childIds: string[]
  ): Promise<{ root: ResyncSessionRow; children: ResyncSessionRow[] } | null> {
    const root = await prisma.session.findFirst({
      where: { id: rootId, workspaceMemberId, parentSessionId: null },
      select: SESSION_SELECT,
    })
    if (!root) return null
    const children =
      childIds.length === 0
        ? []
        : await prisma.session.findMany({
            where: {
              id: { in: childIds },
              parentSessionId: rootId,
              workspaceMemberId,
            },
            select: SESSION_SELECT,
            orderBy: { id: 'asc' },
          })
    return { root: toRow(root), children: children.map(toRow) }
  },

  /** Per-turn usage rows (non-null `usageByModel`) of the given sessions. */
  async findUsageRows(sessionIds: string[]): Promise<ResyncEventRow[]> {
    if (sessionIds.length === 0) return []
    const rows = await prisma.hookEvent.findMany({
      where: {
        sessionId: { in: sessionIds },
        type: { in: [...RESYNC_EVENT_TYPES] },
        NOT: { usageByModel: { equals: Prisma.DbNull } },
      },
      select: { id: true, sessionId: true, usageByModel: true },
      orderBy: { id: 'asc' },
    })
    const out: ResyncEventRow[] = []
    for (const r of rows) {
      const usageByModel = asUsageMap(r.usageByModel)
      if (r.sessionId && usageByModel)
        out.push({ id: r.id, sessionId: r.sessionId, usageByModel })
    }
    return out
  },

  /**
   * Apply one family's correction atomically. Each session update is guarded
   * on "not yet resynced and inactive since before `activeBefore`"; if any
   * guard fails (a concurrent resync or new activity) the whole family rolls
   * back with a 409.
   */
  async applyFamilyResync(data: {
    workspaceId: string
    workspaceMemberId: string
    activeBefore: Date
    now: Date
    sessions: SessionResyncWrite[]
  }): Promise<void> {
    await prisma.$transaction(async tx => {
      for (const s of data.sessions) {
        const { count } = await tx.session.updateMany({
          where: {
            id: s.sessionId,
            usageResyncedAt: null,
            lastActivityAt: { lt: data.activeBefore },
          },
          data: s.usage
            ? {
                inputTokens: s.usage.inputTokens,
                outputTokens: s.usage.outputTokens,
                cacheReadTokens: s.usage.cacheReadTokens,
                cacheCreationTokens: s.usage.cacheCreationTokens,
                usageByModel: json(s.usage.usageByModel),
                liveUsageByModel: json(s.usage.usageByModel),
                usageResyncedAt: data.now,
              }
            : { usageResyncedAt: data.now },
        })
        if (count !== 1) {
          throw Object.assign(
            new Error(`session ${s.sessionId} changed during usage resync`),
            { status: 409 }
          )
        }
        for (const g of groupRowsByValue(s.rows)) {
          const res = await tx.hookEvent.updateMany({
            where: { id: { in: g.ids }, sessionId: s.sessionId },
            data: { usageByModel: json(g.usageByModel) },
          })
          // Every planned row must still exist on this session, or the audit
          // would record rows that were never scaled: roll the family back.
          if (res.count !== g.ids.length) {
            throw new Error(
              `usage resync row mismatch on session ${s.sessionId}: ${res.count}/${g.ids.length}`
            )
          }
        }
        await tx.usageResyncAudit.create({
          data: {
            workspaceId: data.workspaceId,
            sessionId: s.sessionId,
            workspaceMemberId: data.workspaceMemberId,
            before: json(s.audit.before),
            after: json(s.audit.after),
            factors: json(s.audit.factors),
            rows: json(s.audit.rows),
            createdAt: data.now,
          },
        })
      }
    }, RESYNC_TX_OPTIONS)
  },
}
