import { apiFetch } from '@/lib/api-client'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CodeupConfirmedRepository {
  repositoryId: number
  pathWithNamespace: string
  webUrl: string
}

export type CodeupStatus =
  | { connected: false }
  | {
      connected: true
      organizationId: string
      repositories: CodeupConfirmedRepository[]
    }

export interface CodeupRepositoryOption extends CodeupConfirmedRepository {
  confirmed: boolean
}

// ─── Client (LUM-1315) ──────────────────────────────────────────────────────

export const codeupApi = {
  getStatus(workspaceUrl: string): Promise<CodeupStatus> {
    return apiFetch<CodeupStatus>(API.codeup.connection(workspaceUrl))
  },

  connect(
    workspaceUrl: string,
    data: { organizationId: string; accessToken: string }
  ): Promise<{ success: true; repositories: CodeupRepositoryOption[] }> {
    return apiFetch(API.codeup.connection(workspaceUrl), {
      method: 'POST',
      body: data,
    })
  },

  disconnect(workspaceUrl: string): Promise<{ success: true }> {
    return apiFetch(API.codeup.connection(workspaceUrl), { method: 'DELETE' })
  },

  listRepositories(
    workspaceUrl: string
  ): Promise<{ repositories: CodeupRepositoryOption[] }> {
    return apiFetch(API.codeup.repositories(workspaceUrl))
  },

  updateRepositories(
    workspaceUrl: string,
    repositoryIds: number[]
  ): Promise<CodeupStatus> {
    return apiFetch<CodeupStatus>(API.codeup.repositories(workspaceUrl), {
      method: 'PUT',
      body: { repositoryIds },
    })
  },
}
