import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { TrashItemView, TrashKind } from '@/lib/services/trash.service'

/** LUM-918: the settings → Trash page. */
export const trashClient = {
  list() {
    return apiFetch<{ items: TrashItemView[] }>(API.trash.list)
  },

  restore(kind: TrashKind, id: string) {
    return apiFetch<{ restored: true }>(API.trash.restore(kind, id), {
      method: 'POST',
    })
  },

  deletePermanently(kind: TrashKind, id: string) {
    return apiFetch<{ deleted: number }>(API.trash.item(kind, id), {
      method: 'DELETE',
    })
  },
}
