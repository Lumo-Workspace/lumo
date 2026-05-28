import { apiFetch } from '@/lib/api-client'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FigmaIntegrationStatus {
  connected: boolean
  handle?: string
  email?: string | null
  needsReauth?: boolean
}

// ─── Client ─────────────────────────────────────────────────────────────────

export const figmaApi = {
  getStatus(workspaceUrl: string): Promise<FigmaIntegrationStatus> {
    return apiFetch<FigmaIntegrationStatus>(API.figma.integration(workspaceUrl))
  },

  disconnect(workspaceUrl: string): Promise<{ ok: true }> {
    return apiFetch(API.figma.integration(workspaceUrl), {
      method: 'DELETE',
    })
  },
}
