import { apiFetch, ApiClientError } from './base'
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

  parseQuickDispatch<T>(data: unknown, signal?: AbortSignal) {
    return apiFetch<T>(API.tasks.quickDispatchParse, {
      method: 'POST',
      body: data,
      signal,
    })
  },

  executeQuickDispatch<T>(data: unknown) {
    return apiFetch<T>(API.tasks.quickDispatchExecute, {
      method: 'POST',
      body: data,
    })
  },

  searchPrs<T>(workspaceId: string, query: string, limit?: number) {
    const params = new URLSearchParams({ q: query, workspaceId })
    if (limit) params.set('limit', String(limit))
    return apiFetch<T>(`${API.pullRequests.search}?${params}`)
  },

  async linkPr(
    taskId: string,
    data: { prId?: string; url?: string; force?: boolean }
  ) {
    const url = API.pullRequests.link(taskId)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = await res.json()
    if (!res.ok) {
      const err = new ApiClientError(json.error ?? 'Link failed', res.status)
      if (json.conflictTask) {
        ;(err as ApiClientError & { conflictTask: unknown }).conflictTask =
          json.conflictTask
      }
      throw err
    }
    return json
  },

  unlinkPr(taskId: string, prId: string) {
    return apiFetch<void>(API.pullRequests.unlink(taskId, prId), {
      method: 'POST',
    })
  },
}
