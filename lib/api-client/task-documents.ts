import { apiFetch } from './base'

export interface TaskDocumentResource {
  id: string
  title: string
  emoji: string | null
  updatedAt: string
}

export const taskDocumentsClient = {
  list(taskId: string): Promise<{ documents: TaskDocumentResource[] }> {
    return apiFetch(`/api/tasks/${taskId}/documents`)
  },
}
