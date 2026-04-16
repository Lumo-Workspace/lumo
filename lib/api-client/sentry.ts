import { apiFetch } from '@/lib/api-client'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SentryStatus {
  connected: boolean
  orgSlug?: string
  lastWebhookAt?: string | null
  installedBy?: string | null
}

export interface SentryMapping {
  id: string
  sentryProjectSlug: string
  projectId: string
  project?: { id: string; name: string }
}

// ─── Client ─────────────────────────────────────────────────────────────────

export const sentryApi = {
  getStatus(workspaceUrl: string): Promise<SentryStatus> {
    return apiFetch<SentryStatus>(API.sentry.integration(workspaceUrl))
  },

  connect(
    workspaceUrl: string,
    data: { orgSlug: string; clientSecret: string }
  ): Promise<{ success: true; id: string }> {
    return apiFetch(API.sentry.integration(workspaceUrl), {
      method: 'POST',
      body: data,
    })
  },

  disconnect(workspaceUrl: string): Promise<{ success: true }> {
    return apiFetch(API.sentry.integration(workspaceUrl), {
      method: 'DELETE',
    })
  },

  listMappings(workspaceUrl: string): Promise<SentryMapping[]> {
    return apiFetch<SentryMapping[]>(API.sentry.mappings(workspaceUrl))
  },

  createMapping(
    workspaceUrl: string,
    data: { sentryProjectSlug: string; projectId: string }
  ): Promise<SentryMapping> {
    return apiFetch<SentryMapping>(API.sentry.mappings(workspaceUrl), {
      method: 'POST',
      body: data,
    })
  },

  deleteMapping(workspaceUrl: string, id: string): Promise<{ success: true }> {
    return apiFetch(API.sentry.mappingById(workspaceUrl, id), {
      method: 'DELETE',
    })
  },
}
