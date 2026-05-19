import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

interface AttachToTaskInput {
  identity: VerifyApiKeyResult
  taskIdentifier: string
}

interface AttachToTaskResult {
  sessionId: string
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
}

interface BindSessionToTaskInput {
  identity: VerifyApiKeyResult
  sessionId: string
  taskIdentifier: string
}

interface BindSessionToTaskResult {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
}

export const sessionService = {
  /**
   * Attach the user's most recently active session to a task.
   *
   * Mirrors `lumo session start` for the next claude session, but also
   * — and this is the difference — re-tags the **currently running**
   * Session row and bulk-updates its still-null HookEvent rows. After
   * this returns, the task detail timeline shows the session under the
   * new task immediately, no agent restart required.
   *
   * Throws (with a `status` field) when:
   *   - 403: API key holder isn't a member of this workspace
   *   - 404: task identifier doesn't resolve, or no recent session
   */
  async attachToTask({
    identity,
    taskIdentifier,
  }: AttachToTaskInput): Promise<AttachToTaskResult> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Not a workspace member'), { status: 403 })
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

    const session = await sessionRepository.findMostRecentForMember(memberId)
    if (!session) {
      throw Object.assign(
        new Error(
          'No recent session found. Run `claude code` first, or use `lumo session start` to tag the next one.'
        ),
        { status: 404 }
      )
    }

    await sessionRepository.updateTaskId(session.id, task.id)
    const { count } =
      await hookEventRepository.bulkSetTaskIdForNullEventsInSession(
        session.id,
        task.id
      )

    return {
      sessionId: session.id,
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskTitle: task.title,
      retaggedEventCount: count,
    }
  },

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
