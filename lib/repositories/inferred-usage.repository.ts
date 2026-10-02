import type { HookEventType } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { inferredUsageEventsForTasks } from '@/lib/repositories/task-attribution-where'
import {
  addUsageMaps,
  usageMapKindTotals,
  type ModelUsage,
} from '@/lib/services/model-cost'

/**
 * LUM-932 P3: one per-turn usage row of UNATTACHED work attributed to a task
 * (a STOP / STOP_FAILURE delta on the main transcript, or a subagent's settled
 * delta on its SUBAGENT_STOP). Attached sessions are costed from their
 * cumulative `Session.*` columns instead, so these rows never overlap them.
 */
export interface InferredUsageRow {
  taskId: string
  sessionId: string
  /** The top-level session of the family (`parentSessionId ?? sessionId`). */
  rootSessionId: string
  /** Start of the family root — the cost trajectory's point date. */
  rootStartedAt: Date | null
  workspaceMemberId: string
  type: HookEventType
  usageByModel: Record<string, ModelUsage>
}

/**
 * Inferred usage rows folded per (task, session) into the flat token-column
 * shape the cost loaders already sum for explicit sessions. Flat columns are
 * the per-kind totals of the summed map, so the per-model split always
 * reconciles with the flat sum (no unattributed remainder).
 */
export interface InferredSessionTokens {
  id: string
  taskId: string
  rootSessionId: string
  workspaceMemberId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  usageByModel: Record<string, ModelUsage>
}

function isUsageMap(v: unknown): v is Record<string, ModelUsage> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** One query, batched over the task ids. */
export async function inferredUsageForTasks(
  taskIds: string[]
): Promise<InferredUsageRow[]> {
  if (taskIds.length === 0) return []
  const events = await prisma.hookEvent.findMany({
    where: inferredUsageEventsForTasks(taskIds),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      taskId: true,
      sessionId: true,
      workspaceMemberId: true,
      type: true,
      usageByModel: true,
      session: {
        select: {
          parentSessionId: true,
          startedAt: true,
          parent: { select: { startedAt: true } },
        },
      },
    },
  })
  const rows: InferredUsageRow[] = []
  for (const e of events) {
    if (!e.taskId || !e.sessionId || !isUsageMap(e.usageByModel)) continue
    rows.push({
      taskId: e.taskId,
      sessionId: e.sessionId,
      rootSessionId: e.session?.parentSessionId ?? e.sessionId,
      rootStartedAt: e.session?.parentSessionId
        ? (e.session.parent?.startedAt ?? null)
        : (e.session?.startedAt ?? null),
      workspaceMemberId: e.workspaceMemberId,
      type: e.type,
      usageByModel: e.usageByModel,
    })
  }
  return rows
}

/** Fold inferred rows per (task, session) into flat token-column rows. */
export function foldInferredBySession(
  rows: InferredUsageRow[]
): InferredSessionTokens[] {
  const bySession = new Map<string, InferredSessionTokens>()
  for (const r of rows) {
    const key = `${r.taskId}\u0000${r.sessionId}`
    const cur = bySession.get(key)
    const usageByModel = addUsageMaps(cur?.usageByModel ?? null, r.usageByModel)
    const t = usageMapKindTotals(usageByModel)
    bySession.set(key, {
      id: r.sessionId,
      taskId: r.taskId,
      rootSessionId: r.rootSessionId,
      workspaceMemberId: r.workspaceMemberId,
      inputTokens: t.input,
      outputTokens: t.output,
      cacheReadTokens: t.cacheRead,
      cacheCreationTokens: t.cacheCreation,
      usageByModel,
    })
  }
  return [...bySession.values()]
}
