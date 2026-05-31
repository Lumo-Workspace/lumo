import { apiFetch } from './base'
import type { TaskArtifact, TaskArtifactAgent } from '@prisma/client'

export interface CreateArtifactPayload {
  kind: string
  title: string
  content: string
  source: string
  agent: TaskArtifactAgent
}

// Content is intentionally immutable server-side — only metadata is patchable.
// At least one field must be present (enforced by updateArtifactBodySchema).
export interface UpdateArtifactPayload {
  kind?: string
  title?: string
  source?: string
  agent?: TaskArtifactAgent
}

export const artifactsClient = {
  list(taskId: string): Promise<{ artifacts: TaskArtifact[] }> {
    return apiFetch(`/api/tasks/${taskId}/artifacts`)
  },

  add(
    taskId: string,
    payload: CreateArtifactPayload
  ): Promise<{ artifact: TaskArtifact }> {
    return apiFetch(`/api/tasks/${taskId}/artifacts`, {
      method: 'POST',
      body: payload,
    })
  },

  update(
    taskId: string,
    artifactId: string,
    payload: UpdateArtifactPayload
  ): Promise<{ artifact: TaskArtifact }> {
    return apiFetch(`/api/tasks/${taskId}/artifacts/${artifactId}`, {
      method: 'PATCH',
      body: payload,
    })
  },

  remove(taskId: string, artifactId: string): Promise<void> {
    return apiFetch(`/api/tasks/${taskId}/artifacts/${artifactId}`, {
      method: 'DELETE',
    })
  },
}
