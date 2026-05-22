import { apiFetch } from './base'
import type { TaskWebLink } from '@prisma/client'

export const webLinksClient = {
  list(taskId: string): Promise<{ webLinks: TaskWebLink[] }> {
    return apiFetch(`/api/tasks/${taskId}/web-links`)
  },

  add(
    taskId: string,
    payload: { url: string; note?: string }
  ): Promise<{ webLink: TaskWebLink }> {
    return apiFetch(`/api/tasks/${taskId}/web-links`, {
      method: 'POST',
      body: payload,
    })
  },

  remove(taskId: string, linkId: string): Promise<void> {
    return apiFetch(`/api/tasks/${taskId}/web-links/${linkId}`, {
      method: 'DELETE',
    })
  },

  refresh(taskId: string, linkId: string): Promise<{ webLink: TaskWebLink }> {
    return apiFetch(`/api/tasks/${taskId}/web-links/${linkId}/refresh`, {
      method: 'POST',
    })
  },
}
