import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

interface BindSessionToTaskInput {
  identity: VerifyApiKeyResult
  sessionId: string
  taskIdentifier: string
}

interface BindSessionToTaskResult {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  /** Number of HookEvent rows whose null taskId was just filled in by this call. Zero means the session had no untagged events (often the case on re-attach). */
  retaggedEventCount: number
}

export const sessionService = {
  async bindSessionToTask({
    identity,
    sessionId,
    taskIdentifier,
  }: BindSessionToTaskInput): Promise<BindSessionToTaskResult> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Not a workspace member'), { status: 403 })
    }

    const session = await sessionRepository.findByIdForMember(
      sessionId,
      memberId
    )
    if (!session) {
      throw Object.assign(new Error('Session not found'), { status: 404 })
    }

    const task = await taskService.resolveIdentifier(
      identity.workspace.id,
      taskIdentifier
    )
    if (!task) {
      throw Object.assign(
        new Error(`Task ${taskIdentifier} not found in workspace`),
        { status: 404 }
      )
    }

    await sessionRepository.updateTaskId(sessionId, task.id)
    const { count } =
      await hookEventRepository.bulkSetTaskIdForNullEventsInSession(
        sessionId,
        task.id
      )

    return {
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskTitle: task.title,
      retaggedEventCount: count,
    }
  },
}
