import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const documentsClient = {
  list<T>(visibility?: string) {
    const url = visibility
      ? `${API.documents.list}?visibility=${encodeURIComponent(visibility)}`
      : API.documents.list
    return apiFetch<T>(url)
  },

  getById<T>(id: string) {
    return apiFetch<T>(API.documents.byId(id))
  },

  create<T>(data: unknown) {
    return apiFetch<T>(API.documents.list, { method: 'POST', body: data })
  },

  update<T>(id: string, data: unknown) {
    return apiFetch<T>(API.documents.byId(id), { method: 'PATCH', body: data })
  },

  delete(id: string) {
    return apiFetch<void>(API.documents.byId(id), { method: 'DELETE' })
  },

  move<T>(id: string, data: unknown) {
    return apiFetch<T>(API.documents.move(id), { method: 'PATCH', body: data })
  },

  getTree<T>() {
    return apiFetch<T>(API.documents.tree)
  },

  listShares<T>(id: string) {
    return apiFetch<T>(API.documents.shares(id))
  },

  createShare<T>(id: string, data: unknown) {
    return apiFetch<T>(API.documents.shares(id), {
      method: 'POST',
      body: data,
    })
  },

  updateShare<T>(id: string, shareId: string, data: unknown) {
    return apiFetch<T>(API.documents.shareById(id, shareId), {
      method: 'PATCH',
      body: data,
    })
  },

  deleteShare(id: string, shareId: string) {
    return apiFetch<void>(API.documents.shareById(id, shareId), {
      method: 'DELETE',
    })
  },
}
