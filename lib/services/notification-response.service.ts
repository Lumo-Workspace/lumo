import { taskRepository } from '@/lib/repositories/task.repository'
import { notificationService } from '@/lib/services/notification.service'
import { resumeAgent } from '@/lib/services/clarification.service'
import {
  clearAgentStatus,
  transitionAgentStatus,
  executeAgent,
} from '@/lib/services/agent-orchestration.service'
import { transitionTaskStatus } from '@/lib/task/state-machine'
import {
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Notification = Awaited<
  ReturnType<typeof notificationService.loadForRespond>
>

type TaskForAgent = NonNullable<
  Awaited<ReturnType<typeof taskRepository.findForAgent>>
>

interface BaseParams {
  notificationId: string
  actorClerkId: string
  workspaceId: string
  taskId: string
  notification: Notification
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run agent either via proxy or locally. */
async function runAgent(opts: {
  taskId: string
  actorClerkId: string
  trigger: string
}): Promise<void> {
  if (isAgentServiceEnabled()) {
    await proxyToAgentService('/api/agent/execute', opts)
  } else {
    await executeAgent(opts)
  }
}

/** Load and authorise task for the given workspace. Throws on not-found / forbidden. */
async function loadTask(
  taskId: string,
  workspaceId: string
): Promise<TaskForAgent> {
  const task = await taskRepository.findForAgent(taskId)
  if (!task) {
    throw Object.assign(new Error('Task not found'), { status: 404 })
  }
  if (task.project.workspaceId !== workspaceId) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }
  return task
}

// ---------------------------------------------------------------------------
// AGENT_CLARIFY — action='reply'
// ---------------------------------------------------------------------------

export async function handleClarifyResponse(
  params: BaseParams & { reply: string }
): Promise<{ ok: true }> {
  const { notificationId, actorClerkId, taskId, workspaceId, notification } =
    params
  const task = await loadTask(taskId, workspaceId)

  // Mark actionTakenAt first to prevent double-submission
  await notificationService.markActionTaken(notificationId)

  if (task.agentStatus === 'INPUT_REQUIRED') {
    // Resume agent — DB update only, MCP server picks up reply via HTTP poll
    try {
      await resumeAgent(taskId, task.projectId, params.reply)
    } catch {
      // Resume failed — fall through to re-run
      await taskRepository.clearAgentError(taskId)
      if (notification.clarifyId) {
        await notificationService.replyClarify(
          notification.clarifyId,
          params.reply
        )
      }
      await runAgent({
        taskId,
        actorClerkId,
        trigger: 'clarify_reply',
      }).catch(err => {
        console.error(`[notification-response] Re-run failed:`, err)
      })
    }
  } else {
    // Task not INPUT_REQUIRED — re-run the agent fresh
    await taskRepository.clearAgentError(taskId)
    if (notification.clarifyId) {
      await notificationService.replyClarify(
        notification.clarifyId,
        params.reply
      )
    }
    await executeAgent({
      taskId,
      actorClerkId,
      trigger: 'clarify_reply',
    }).catch(err => {
      console.error(`[notification-response] Re-run failed:`, err)
    })
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// AGENT_AUTHORIZE — action='approve' | 'deny'
// ---------------------------------------------------------------------------

export async function handleAuthorizeResponse(
  params: BaseParams & { action: 'approve' | 'deny' }
): Promise<{ ok: true }> {
  const { notificationId, actorClerkId, taskId, workspaceId } = params
  const task = await loadTask(taskId, workspaceId)

  await notificationService.markActionTaken(notificationId)

  if (params.action === 'approve') {
    const reply = 'APPROVED'
    if (task.agentStatus === 'INPUT_REQUIRED') {
      try {
        await resumeAgent(taskId, task.projectId, reply)
      } catch {
        await taskRepository.clearAgentError(taskId)
        await runAgent({
          taskId,
          actorClerkId,
          trigger: 'clarify_reply',
        }).catch(err => {
          console.error(`[notification-response] Approve re-run failed:`, err)
        })
      }
    } else {
      await taskRepository.clearAgentError(taskId)
      await executeAgent({
        taskId,
        actorClerkId,
        trigger: 'clarify_reply',
      }).catch(err => {
        console.error(`[notification-response] Approve re-run failed:`, err)
      })
    }
  } else {
    // Deny: fail the agent
    await transitionAgentStatus(taskId, task.projectId, 'FAILED', {
      agentError: 'AUTHORIZATION_DENIED',
    })
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// AGENT_VERIFY — action='confirm' | 'send_back'
// ---------------------------------------------------------------------------

export async function handleVerifyResponse(
  params: BaseParams & { action: 'confirm' | 'send_back' }
): Promise<{ ok: true }> {
  const { notificationId, actorClerkId, taskId, workspaceId } = params
  const task = await loadTask(taskId, workspaceId)

  // Mark actionTakenAt first
  await notificationService.markActionTaken(notificationId)

  if (params.action === 'confirm') {
    // Transition task → DONE
    await transitionTaskStatus(taskId, task.projectId, 'DONE', {
      currentStatus: task.status as
        | 'TODO'
        | 'IN_PROGRESS'
        | 'IN_REVIEW'
        | 'DONE',
    })
  } else {
    // send_back: clear agent status and re-run
    await clearAgentStatus(taskId, task.projectId)
    await taskRepository.clearAgentError(taskId)
    await runAgent({
      taskId,
      actorClerkId,
      trigger: 'send_back',
    }).catch(err => {
      console.error(`[notification-response] Send-back re-run failed:`, err)
    })
  }

  return { ok: true }
}
