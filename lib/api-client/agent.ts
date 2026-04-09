import { apiFetch, apiFetchQuiet } from './base'

export const agentClient = {
  async execute(taskId: string): Promise<void> {
    return apiFetch('/api/agent/execute', {
      method: 'POST',
      body: { taskId },
    })
  },
  async cancel(taskId: string): Promise<void> {
    await apiFetchQuiet('/api/agent/cancel', {
      method: 'POST',
      body: { taskId },
    })
  },
  async confirmSpec(taskId: string, spec: string): Promise<void> {
    return apiFetch('/api/agent/confirm-spec', {
      method: 'POST',
      body: { taskId, spec },
    })
  },
  async resume(
    taskId: string,
    workspaceId: string,
    reply: string
  ): Promise<void> {
    await apiFetchQuiet('/api/agent/resume', {
      method: 'POST',
      body: { taskId, workspaceId, reply },
    })
  },
}
