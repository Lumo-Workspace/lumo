import { apiFetch } from './base'
import type { TaskArtifact } from '@prisma/client'

export interface CreateArtifactPayload {
  kind: string
  title: string
  content: string
  source?: string
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
}
