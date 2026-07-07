import { apiFetch } from './base'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IdeaFigmaLinkJson {
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

export const ideaFigmaLinksClient = {
  list(ideaId: string): Promise<{ links: IdeaFigmaLinkJson[] }> {
    return apiFetch(`/api/ideas/${ideaId}/figma`)
  },

  add(
    ideaId: string,
    payload: { url: string }
  ): Promise<{ link: IdeaFigmaLinkJson }> {
    return apiFetch(`/api/ideas/${ideaId}/figma`, {
      method: 'POST',
      body: payload,
    })
  },

  remove(ideaId: string, linkId: string): Promise<void> {
    return apiFetch(`/api/ideas/${ideaId}/figma/${linkId}`, {
      method: 'DELETE',
    })
  },

  refreshAll(
    ideaId: string
  ): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }> }> {
    return apiFetch(`/api/ideas/${ideaId}/figma/refresh`, {
      method: 'POST',
    })
  },
}
