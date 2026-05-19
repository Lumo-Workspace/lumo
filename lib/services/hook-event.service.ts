import type { HookEventType, Prisma } from '@prisma/client'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

interface RecordHookEventInput {
  identity: VerifyApiKeyResult
  type: HookEventType
  payload: Prisma.InputJsonValue
}

function extractStringField(payload: unknown, field: string): string | null {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export const hookEventService = {
  async recordHookEvent({ identity, type, payload }: RecordHookEventInput) {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(
        new Error('Workspace member not found for API key holder'),
        { status: 403 }
      )
    }

    const sessionId = extractStringField(payload, 'session_id')
    const cwd = extractStringField(payload, 'cwd')

    // Upsert Session before the HookEvent insert so the FK resolves, and
    // read back Session.taskId — server-authoritative now that the CLI no
    // longer carries a per-session sentinel. If session_id is missing
    // (malformed or non-Claude-Code client), record the event unlinked
    // (matches Day 3 tolerance) with no taskId tag.
    let taskId: string | null = null
    if (sessionId) {
      const session = await sessionRepository.upsertForHookEvent({
        id: sessionId,
        workspaceId: identity.workspace.id,
        workspaceMemberId: memberId,
        cwd,
        now: new Date(),
      })
      taskId = session.taskId
    }

    const created = await hookEventRepository.createHookEvent({
      workspaceId: identity.workspace.id,
      workspaceMemberId: memberId,
      sessionId,
      taskId,
      type,
      toolName: extractStringField(payload, 'tool_name'),
      payload,
    })

    // Surface the validated sessionId/taskId so per-event side effects (e.g.
    // Stop → Layer 1 memory extraction) can fire-and-forget without
    // re-deriving them.
    return { id: created.id, sessionId, taskId }
  },
}
