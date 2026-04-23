import type { HookEventType, Prisma } from '@prisma/client'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

interface RecordHookEventInput {
  identity: VerifyApiKeyResult
  type: HookEventType
  payload: Prisma.InputJsonValue
}

function extractToolName(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>).tool_name
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

    return hookEventRepository.createHookEvent({
      workspaceId: identity.workspace.id,
      workspaceMemberId: memberId,
      type,
      toolName: extractToolName(payload),
      payload,
    })
  },
}
