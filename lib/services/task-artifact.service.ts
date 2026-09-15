import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
import { contentSummaryService } from '@/lib/services/content-summary.service'
import { waitUntil } from '@vercel/functions'
import type { TaskArtifactAgent } from '@prisma/client'
import { scanContent } from '@/lib/services/content-signals'

export interface AddArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string
  agent: TaskArtifactAgent
  actorMemberId: string | null
}

export interface UpdateArtifactInput {
  kind?: string | undefined
  title?: string | undefined
  source?: string | undefined
  agent?: TaskArtifactAgent | undefined
}

export const taskArtifactService = {
  async listForTask(taskId: string) {
    return taskArtifactRepository.listByTask(taskId)
  },

  async addArtifact(input: AddArtifactInput) {
    const order = await taskArtifactRepository.countByTask(input.taskId)
    const created = await taskArtifactRepository.create({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      source: input.source,
      agent: input.agent,
      order,
      createdById: input.actorMemberId,
      // LUM-783: title + content are agent/member-authored untrusted text.
      contentSignals: scanContent(input.title, input.content),
    })

    // Artifact content is immutable, so summarize once at creation and cache it.
    // Fire-and-forget via waitUntil so it never blocks the response; swallow
    // errors so a summarization failure never surfaces to the caller.
    waitUntil(
      contentSummaryService
        .summarize(created.content, 'artifact')
        .then(s =>
          s ? taskArtifactRepository.updateSummary(created.id, s) : undefined
        )
        .catch(() => {})
    )

    return created
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
    // LUM-783: content is immutable, so only a title change moves the scan;
    // re-scan against the stored content so the summary stays whole-card.
    let data: UpdateArtifactInput & {
      contentSignals?: ReturnType<typeof scanContent>
    } = patch
    if (patch.title !== undefined) {
      const existing = await taskArtifactRepository.findById(artifactId, taskId)
      if (existing) {
        data = {
          ...patch,
          contentSignals: scanContent(patch.title, existing.content),
        }
      }
    }
    const count = await taskArtifactRepository.updateById(
      artifactId,
      taskId,
      data
    )
    if (count === 0) {
      throw Object.assign(new Error('Artifact not found'), { status: 404 })
    }
    return taskArtifactRepository.findById(artifactId, taskId)
  },
}
