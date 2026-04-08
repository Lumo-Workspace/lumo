import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const workspacesClient = {
  create<T>(data: unknown) {
    return apiFetch<T>('/api/workspaces', { method: 'POST', body: data })
  },

  getMe<T>() {
    return apiFetch<T>(API.workspaces.me)
  },

  updateMe<T>(data: unknown) {
    return apiFetch<T>(API.workspaces.me, { method: 'PATCH', body: data })
  },

  uploadLogo(formData: FormData): Promise<Response> {
    return fetch(API.workspaces.logo, {
      method: 'POST',
      body: formData,
    })
  },

  listMembers<T>() {
    return apiFetch<T>(API.workspaces.members)
  },

  updateMember<T>(id: string, data: unknown) {
    return apiFetch<T>(API.workspaces.memberById(id), {
      method: 'PATCH',
      body: data,
    })
  },

  removeMember(id: string) {
    return apiFetch<void>(API.workspaces.memberById(id), { method: 'DELETE' })
  },

  leaveWorkspace() {
    return apiFetch<void>(API.workspaces.leaveWorkspace, { method: 'DELETE' })
  },
}
