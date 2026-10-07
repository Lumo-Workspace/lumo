import { apiFetch } from './base'
import type { SlackContextSnapshot } from '@/types/slack-context'
import type { ContentSignals } from '@/shared/src/untrusted-content'

export interface SlackContextResource {
  id: string
  taskId: string
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
  /** LUM-783: write-time injection scan of the snapshot; null = clean. */
  contentSignals?: ContentSignals | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export const slackContextsClient = {
  list(taskId: string): Promise<{ contexts: SlackContextResource[] }> {
    return apiFetch(`/api/tasks/${taskId}/slack-contexts`)
  },
  link(
    taskId: string,
    permalink: string
  ): Promise<{ context: SlackContextResource }> {
    return apiFetch(`/api/tasks/${taskId}/slack-contexts`, {
      method: 'POST',
      body: { permalink },
    })
  },
  unlink(taskId: string, contextId: string): Promise<void> {
    return apiFetch(`/api/tasks/${taskId}/slack-contexts/${contextId}`, {
      method: 'DELETE',
    })
  },
  refresh(
    taskId: string,
    contextId: string
  ): Promise<{ context: SlackContextResource }> {
    return apiFetch(
      `/api/tasks/${taskId}/slack-contexts/${contextId}/refresh`,
      {
        method: 'POST',
      }
    )
  },
}
