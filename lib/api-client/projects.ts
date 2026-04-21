import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const projectsClient = {
  list<T>() {
    return apiFetch<T>(API.projects.list)
  },

  getById<T>(id: string) {
    return apiFetch<T>(API.projects.byId(id))
  },

  create<T>(data: unknown) {
    return apiFetch<T>(API.projects.list, { method: 'POST', body: data })
  },

  update<T>(id: string, data: unknown) {
    return apiFetch<T>(API.projects.byId(id), { method: 'PATCH', body: data })
  },

  delete(id: string) {
    return apiFetch<void>(API.projects.byId(id), { method: 'DELETE' })
  },

  listTasks<T>(projectId: string) {
    return apiFetch<T>(API.projects.tasks(projectId))
  },

  createTask<T>(projectId: string, data: unknown) {
    return apiFetch<T>(API.projects.tasks(projectId), {
      method: 'POST',
      body: data,
    })
  },

  reorder<T>(orderedIds: string[]) {
    return apiFetch<T>(API.projects.reorder, {
      method: 'PATCH',
      body: { orderedIds },
    })
  },
}
