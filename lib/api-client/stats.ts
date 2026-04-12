import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const statsClient = {
  getProjectStats<T>(projectId: string) {
    return apiFetch<T>(API.stats.project(projectId))
  },

  getWorkspaceStats<T>() {
    return apiFetch<T>(API.stats.workspace)
  },
}
