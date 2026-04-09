import { apiFetch } from './base'

const BASE = '/api/tags'

export const tagsClient = {
  list<T>() {
    return apiFetch<T>(BASE)
  },

  create<T>(data: { name: string; color?: string }) {
    return apiFetch<T>(BASE, { method: 'POST', body: data })
  },

  update<T>(id: string, data: { name?: string; color?: string | null }) {
    return apiFetch<T>(`${BASE}/${id}`, { method: 'PATCH', body: data })
  },

  delete(id: string) {
    return apiFetch<void>(`${BASE}/${id}`, { method: 'DELETE' })
  },
}
