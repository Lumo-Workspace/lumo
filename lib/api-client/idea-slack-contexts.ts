import { apiFetch } from './base'
import type { SlackContextSnapshot } from '@/types/slack-context'

export interface IdeaSlackContextResource {
  id: string
  ideaId: string
  workspaceId: string
  permalink: string
  slackTeamId: string
  slackChannelId: string
  slackChannelName: string | null
  rootTs: string
  threadTs: string | null
  isThread: boolean
  snapshot: SlackContextSnapshot
  snapshotAt: string
  refreshError: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export const ideaSlackContextsClient = {
  list(ideaId: string): Promise<{ contexts: IdeaSlackContextResource[] }> {
    return apiFetch(`/api/ideas/${ideaId}/slack-contexts`)
  },
  link(
    ideaId: string,
    permalink: string
  ): Promise<{ context: IdeaSlackContextResource }> {
    return apiFetch(`/api/ideas/${ideaId}/slack-contexts`, {
      method: 'POST',
      body: { permalink },
    })
  },
  unlink(ideaId: string, contextId: string): Promise<void> {
    return apiFetch(`/api/ideas/${ideaId}/slack-contexts/${contextId}`, {
      method: 'DELETE',
    })
  },
  refresh(
    ideaId: string,
    contextId: string
  ): Promise<{ context: IdeaSlackContextResource }> {
    return apiFetch(
      `/api/ideas/${ideaId}/slack-contexts/${contextId}/refresh`,
      {
        method: 'POST',
      }
    )
  },
}
