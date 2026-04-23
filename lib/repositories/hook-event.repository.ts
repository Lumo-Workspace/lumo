import { prisma } from '@/lib/db/prisma'
import type { HookEventType, Prisma } from '@prisma/client'

// ── Types ────────────────────────────────────────────────────────────────────

interface CreateHookEventData {
  workspaceId: string
  workspaceMemberId: string
  type: HookEventType
  toolName: string | null
  payload: Prisma.InputJsonValue
  sessionId?: string | null
  taskId?: string | null
}

// ── HookEvent Repository ──────────────────────────────────────────────────────

export const hookEventRepository = {
  /** Record a Claude Code hook event for audit and activity tracking. */
  async createHookEvent(data: CreateHookEventData) {
    return prisma.hookEvent.create({
      data: {
        workspaceId: data.workspaceId,
        workspaceMemberId: data.workspaceMemberId,
        sessionId: data.sessionId ?? null,
        taskId: data.taskId ?? null,
        type: data.type,
        toolName: data.toolName,
        payload: data.payload,
      },
      select: { id: true },
    })
  },
}
