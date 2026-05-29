import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'

export interface AddArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string
  actorMemberId: string | null
}

export interface UpdateArtifactInput {
  kind?: string | undefined
  title?: string | undefined
  source?: string | undefined
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
      source: input.source,
      order,
      createdById: input.actorMemberId,
    })
  },

  async getById(taskId: string, artifactId: string) {
    const artifact = await taskArtifactRepository.findById(artifactId, taskId)
    if (!artifact) {
      throw Object.assign(new Error('Artifact not found'), { status: 404 })
    }
    return artifact
  },

  async removeArtifact(taskId: string, artifactId: string) {
    const count = await taskArtifactRepository.deleteById(artifactId, taskId)
    if (count === 0) {
      throw Object.assign(new Error('Artifact not found'), { status: 404 })
    }
  },

  async updateArtifact(
    taskId: string,
    artifactId: string,
    patch: UpdateArtifactInput
  ) {
    const count = await taskArtifactRepository.updateById(
      artifactId,
      taskId,
      patch
    )
    if (count === 0) {
      throw Object.assign(new Error('Artifact not found'), { status: 404 })
    }
    return taskArtifactRepository.findById(artifactId, taskId)
  },
}
