import type { HookEventType, Prisma } from '@prisma/client'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
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
    const taskIdCandidate = extractStringField(payload, 'task_id')

    // Validate task_id belongs to this workspace before letting it through to
    // Session. A stale/compromised ~/.lumo/current-task.json must not poison
    // another workspace's FK. Any failure degrades to "no task tag" rather
    // than rejecting the hook — Session linkage is opt-in metadata, not
    // load-bearing for event recording.
    let taskId: string | null = null
    if (taskIdCandidate) {
      const ok = await taskRepository.belongsToWorkspace(
        taskIdCandidate,
        identity.workspace.id
      )
      if (ok) taskId = taskIdCandidate
    }

    // Upsert Session before the HookEvent insert so the FK resolves. If
    // session_id is missing (malformed or non-Claude-Code client), we still
    // record the event unlinked — matches Day 3 tolerance.
    if (sessionId) {
      await sessionRepository.upsertForHookEvent({
        id: sessionId,
        workspaceId: identity.workspace.id,
        workspaceMemberId: memberId,
        cwd,
        taskId,
        now: new Date(),
      })
    }

    const created = await hookEventRepository.createHookEvent({
      workspaceId: identity.workspace.id,
      workspaceMemberId: memberId,
      sessionId,
      type,
      toolName: extractStringField(payload, 'tool_name'),
      payload,
    })

    // Surface the validated sessionId/taskId so per-event side effects (e.g.
    // Stop → Layer 1 memory extraction) can fire-and-forget without
    // re-deriving them. Returning a richer object here keeps the validation
    // (workspace membership, task FK check) authoritative in one place.
    return { id: created.id, sessionId, taskId }
  },
}
