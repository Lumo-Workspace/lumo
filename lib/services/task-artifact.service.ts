import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'

export interface AddArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string | undefined
  actorMemberId: string | null
}

export const taskArtifactService = {
  async listForTask(taskId: string) {
    return taskArtifactRepository.listByTask(taskId)
  },

  async addArtifact(input: AddArtifactInput) {
    const order = await taskArtifactRepository.countByTask(input.taskId)
    return taskArtifactRepository.create({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      source: input.source ?? 'claude-code',
      order,
      createdById: input.actorMemberId,
    })
  },
}
