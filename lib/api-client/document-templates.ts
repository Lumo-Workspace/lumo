import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const documentTemplatesClient = {
  list<T>() {
    return apiFetch<T>(API.documentTemplates.list)
  },
}
