import { apiFetch } from './base'
import type { IdeaWebLink } from '@prisma/client'

export const ideaWebLinksClient = {
  list(ideaId: string): Promise<{ webLinks: IdeaWebLink[] }> {
    return apiFetch(`/api/ideas/${ideaId}/web-links`)
  },

  add(
    ideaId: string,
    payload: { url: string }
  ): Promise<{ webLink: IdeaWebLink }> {
    return apiFetch(`/api/ideas/${ideaId}/web-links`, {
      method: 'POST',
      body: payload,
    })
  },

  remove(ideaId: string, linkId: string): Promise<void> {
    return apiFetch(`/api/ideas/${ideaId}/web-links/${linkId}`, {
      method: 'DELETE',
    })
  },

  refresh(ideaId: string, linkId: string): Promise<{ webLink: IdeaWebLink }> {
    return apiFetch(`/api/ideas/${ideaId}/web-links/${linkId}/refresh`, {
      method: 'POST',
    })
  },
}
