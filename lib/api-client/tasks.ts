import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const tasksClient = {
  listMine<T>() {
    return apiFetch<T>(API.tasks.me)
  },

  getById<T>(id: string) {
    return apiFetch<T>(API.tasks.byId(id))
  },

  update<T>(id: string, data: unknown) {
    return apiFetch<T>(API.tasks.byId(id), { method: 'PATCH', body: data })
  },

  delete(id: string) {
    return apiFetch<void>(API.tasks.byId(id), { method: 'DELETE' })
  },

  createBranch<T>(id: string, data: unknown) {
    return apiFetch<T>(API.tasks.branch(id), { method: 'POST', body: data })
  },

  listComments<T>(taskId: string) {
    return apiFetch<T>(API.tasks.comments(taskId))
  },

  createComment<T>(taskId: string, data: unknown) {
    return apiFetch<T>(API.tasks.comments(taskId), {
      method: 'POST',
      body: data,
    })
  },

  updateComment<T>(taskId: string, commentId: string, data: unknown) {
    return apiFetch<T>(API.tasks.comment(taskId, commentId), {
      method: 'PATCH',
      body: data,
    })
  },

  deleteComment(taskId: string, commentId: string) {
    return apiFetch<void>(API.tasks.comment(taskId, commentId), {
      method: 'DELETE',
    })
  },

  suggestPriority<T>(data: unknown, signal?: AbortSignal) {
    return apiFetch<T>('/api/tasks/suggest-priority', {
      method: 'POST',
      body: data,
      signal,
    })
  },
}
