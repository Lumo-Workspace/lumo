import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const notificationsClient = {
  list<T>() {
    return apiFetch<T>(API.notifications.list)
  },

  markAllRead() {
    return apiFetch<void>(API.notifications.markAllRead, { method: 'PATCH' })
  },

  markOne(id: string, data?: unknown) {
    return apiFetch<void>(API.notifications.markOne(id), {
      method: 'PATCH',
      ...(data !== undefined && { body: data }),
    })
  },

  deleteOne(id: string) {
    return apiFetch<void>(API.notifications.markOne(id), { method: 'DELETE' })
  },

  respond<T>(id: string, data: unknown) {
    return apiFetch<T>(API.notifications.respond(id), {
      method: 'POST',
      body: data,
    })
  },
}
