import { apiFetch } from './base'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FigmaLinkJson {
  id: string
  fileKey: string
  nodeId: string
  url: string
  fileName: string
  frameName: string | null
  thumbnailUrl: string | null
  thumbnailFetchedAt: string | null
  lastSyncedAt: string
  lastSyncError: string | null
  createdAt: string
}

// ─── Client ──────────────────────────────────────────────────────────────────

export const taskFigmaLinksClient = {
  list(taskId: string): Promise<{ links: FigmaLinkJson[] }> {
    return apiFetch(`/api/tasks/${taskId}/figma`)
  },

  add(
    taskId: string,
    payload: { url: string }
  ): Promise<{ link: FigmaLinkJson }> {
    return apiFetch(`/api/tasks/${taskId}/figma`, {
      method: 'POST',
      body: payload,
    })
  },

  remove(taskId: string, linkId: string): Promise<void> {
    return apiFetch(`/api/tasks/${taskId}/figma/${linkId}`, {
      method: 'DELETE',
    })
  },

  refreshAll(
    taskId: string
  ): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }> }> {
    return apiFetch(`/api/tasks/${taskId}/figma/refresh`, {
      method: 'POST',
    })
  },
}
