import { apiFetch } from './base'

/** LUM-1303: one task decision as the API returns it (dates as ISO strings). */
export interface TaskDecisionDto {
  id: string
  taskId: string
  number: number
  text: string
  rationale: string | null
  createdById: string | null
  sourceSessionId: string | null
  createdAt: string
  updatedAt: string
}

export const taskDecisionsClient = {
  list(taskId: string): Promise<{ decisions: TaskDecisionDto[] }> {
    return apiFetch(`/api/tasks/${taskId}/decisions`)
  },

  create(
    taskId: string,
    payload: { text: string; rationale?: string | null }
  ): Promise<{ decision: TaskDecisionDto }> {
    return apiFetch(`/api/tasks/${taskId}/decisions`, {
      method: 'POST',
      body: payload,
    })
  },

  update(
    taskId: string,
    decisionId: string,
    payload: { text?: string; rationale?: string | null }
  ): Promise<{ decision: TaskDecisionDto }> {
    return apiFetch(`/api/tasks/${taskId}/decisions/${decisionId}`, {
      method: 'PATCH',
      body: payload,
    })
  },

  remove(taskId: string, decisionId: string): Promise<void> {
    return apiFetch(`/api/tasks/${taskId}/decisions/${decisionId}`, {
      method: 'DELETE',
    })
  },
}
