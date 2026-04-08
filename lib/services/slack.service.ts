import { slackRepository } from '@/lib/repositories/slack.repository'
import type {
  UpsertSlackIntegrationData,
  CreateSlackChannelData,
  UpdateSlackChannelData,
} from '@/lib/repositories/slack.repository'
import type { SlackEventType } from '@/lib/slack/types'

// ── Slack Service ───────────────────────────────────────────────────────────

export const slackService = {
  /** Get Slack integration status for a workspace. */
  async getIntegrationStatus(workspaceId: string) {
    const integration = await slackRepository.findIntegrationStatus(workspaceId)
    if (!integration) {
      return { connected: false } as const
    }
    return { connected: true, ...integration } as const
  },

  /** Find integration with token or throw 404. */
  async requireIntegrationWithToken(workspaceId: string) {
    const integration =
      await slackRepository.findIntegrationWithToken(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Slack not connected'), { status: 404 })
    }
    return integration
  },

  /** Find integration id or throw 404. */
  async requireIntegrationId(workspaceId: string) {
    const integration = await slackRepository.findIntegrationId(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Slack not connected'), { status: 404 })
    }
    return integration
  },

  /** Upsert integration from OAuth callback. */
  async upsertIntegration(data: UpsertSlackIntegrationData) {
    return slackRepository.upsertIntegration(data)
  },

  /** Delete integration. Only workspace owners are allowed. */
  async deleteIntegration(workspaceId: string, memberRole: string) {
    if (memberRole !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can disconnect Slack'),
        { status: 403 }
      )
    }

    const integration =
      await slackRepository.findIntegrationWithToken(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Not connected'), { status: 404 })
    }

    return {
      integrationToken: integration.accessToken,
      performDelete: () => slackRepository.deleteIntegration(workspaceId),
    }
  },

  // ── Channels ──────────────────────────────────────────────────────────

  /** Get channel configuration for a project. */
  async getChannelForProject(workspaceId: string, projectId: string) {
    const integration = await slackRepository.findIntegrationId(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Not connected'), { status: 404 })
    }
    return slackRepository.findChannelByProject(integration.id, projectId)
  },

  /** Link a Slack channel to a project. */
  async createChannel(
    workspaceId: string,
    data: {
      channelId: string
      channelName: string
      projectId: string
      events: SlackEventType[]
    }
  ) {
    const integration = await slackRepository.findIntegrationId(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Not connected'), { status: 404 })
    }

    // Verify project belongs to workspace
    const project = await slackRepository.findProjectInWorkspace(
      data.projectId,
      workspaceId
    )
    if (!project) {
      throw Object.assign(new Error('Project not found'), { status: 403 })
    }

    // Check for existing channel
    const exists = await slackRepository.channelExistsForProject(
      integration.id,
      data.projectId
    )
    if (exists) {
      throw Object.assign(
        new Error('Channel already configured for this project'),
        { status: 409 }
      )
    }

    const channelData: CreateSlackChannelData = {
      integrationId: integration.id,
      channelId: data.channelId,
      channelName: data.channelName,
      events: data.events,
      projectId: data.projectId,
    }

    return slackRepository.createChannel(channelData)
  },

  /** Update a channel's settings after verifying ownership. */
  async updateChannel(
    channelRecordId: string,
    workspaceId: string,
    data: UpdateSlackChannelData
  ) {
    const channel =
      await slackRepository.findChannelWithIntegration(channelRecordId)
    if (!channel || channel.integration.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return slackRepository.updateChannel(channelRecordId, data)
  },

  /** Delete a channel mapping after verifying ownership. */
  async deleteChannel(channelRecordId: string, workspaceId: string) {
    const channel =
      await slackRepository.findChannelWithIntegration(channelRecordId)
    if (!channel || channel.integration.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return slackRepository.deleteChannel(channelRecordId)
  },
}
