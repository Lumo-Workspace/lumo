import type { AgentStatus } from '@prisma/client'
import { agentRepository } from '@/lib/repositories/agent.repository'
import { transitionAgentStatus } from '@/lib/agent/state-machine'
import { pushAgentEvent } from '@/lib/pusher/server'

export const agentService = {
  /**
   * Cancel an active agent run for a task.
   * Finds the active run, transitions the task status to CANCELED,
   * and marks the run as canceled.
   * Returns the active run (with sandboxId) so the caller can kill the sandbox.
   */
  async cancelAgent(
    taskId: string,
    projectId: string,
    currentStatus: AgentStatus | null
  ) {
    const activeRun = await agentRepository.findActiveRun(taskId)

    await transitionAgentStatus(taskId, projectId, 'CANCELED', {
      currentStatus,
    })

    if (activeRun) {
      await agentRepository.cancelRun(activeRun.id)
    }

    await pushAgentEvent(taskId, {
      type: 'agent:failed',
      error: 'Cancelled by user',
    })

    return activeRun
  },

  /**
   * Time out a single task that has been waiting for clarification too long.
   * Transitions status to FAILED and marks the active run as failed.
   * Returns the active run (with sandboxId) so the caller can kill the sandbox.
   */
  async timeoutTask(taskId: string, projectId: string) {
    const activeRun = await agentRepository.findActiveRun(taskId)

    await transitionAgentStatus(taskId, projectId, 'FAILED', {
      agentError: 'CLARIFY_TIMEOUT',
      currentStatus: 'INPUT_REQUIRED',
    })

    if (activeRun) {
      await agentRepository.failRun(
        activeRun.id,
        'CLARIFY_TIMEOUT',
        'Agent was waiting for clarification for 24 hours and has been stopped.'
      )
    }

    await pushAgentEvent(taskId, {
      type: 'agent:failed',
      error:
        'Agent was waiting for clarification for 24 hours and has been stopped. Add more details to the spec and retry.',
    })

    return activeRun
  },

  /**
   * Find all tasks that have timed out waiting for clarification.
   */
  async findTimedOutTasks() {
    return agentRepository.findTimedOutTasks()
  },
}
