import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

export const summariesClient = {
  getProjectSummaries<T>(projectId: string, limit = 1, before?: string) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (before) params.set('before', before)
    return apiFetch<T>(`${API.summaries.project(projectId)}?${params}`)
  },

  getWorkspaceSummaries<T>(limit = 1, before?: string) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (before) params.set('before', before)
    return apiFetch<T>(`${API.summaries.workspace}?${params}`)
  },

  generateProject(projectId: string) {
    return apiFetch<{ jobId: string }>(
      API.summaries.generateProject(projectId),
      { method: 'POST' }
    )
  },

  generateWorkspace() {
    return apiFetch<{ jobId: string }>(API.summaries.generateWorkspace, {
      method: 'POST',
    })
  },

  getJobStatus(jobId: string) {
    return apiFetch<{ status: string; summaryId: string | null }>(
      API.summaries.jobStatus(jobId)
    )
  },
}
