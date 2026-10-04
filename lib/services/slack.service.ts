import { decrypt } from '@/lib/crypto'
import { slackRepository } from '@/lib/repositories/slack.repository'
import type {
  UpsertSlackIntegrationData,
  CreateSlackChannelData,
  UpdateSlackChannelData,
} from '@/lib/repositories/slack.repository'
import type { SlackEventType } from '@/lib/integrations/slack'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

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
  async upsertIntegration(
    data: UpsertSlackIntegrationData,
    audit?: AuditContext
  ) {
    const row = await slackRepository.upsertIntegration(data)
    await recordAuditEvent({
      workspaceId: data.workspaceId,
      action: 'slack.connected',
      target: { type: 'integration', id: 'slack' },
      metadata: { slackTeamId: data.slackTeamId },
      context: audit,
    })
    return row
  },

  /** Delete integration. Only workspace owners are allowed. */
  async deleteIntegration(
    workspaceId: string,
    memberRole: string,
    audit?: AuditContext
  ) {
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
      performDelete: async () => {
        const deleted = await slackRepository.deleteIntegration(workspaceId)
        await recordAuditEvent({
          workspaceId,
          action: 'slack.disconnected',
          target: { type: 'integration', id: 'slack' },
          context: audit,
        })
        return deleted
      },
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

  /**
   * Create a Slack channel and invite a user.
   * Handles channel name validation, Slack API call, and user invite (fire-and-forget).
   * Returns the channel info or throws with status on error.
   */
  async createChannelWithInvite(
    workspaceId: string,
    name: string,
    isPrivate: boolean,
    inviteClerkId: string
  ) {
    const integration =
      await slackRepository.findIntegrationWithToken(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Slack not connected'), { status: 404 })
    }

    const token = decrypt(integration.accessToken)

    const res = await fetch('https://slack.com/api/conversations.create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, is_private: isPrivate }),
    })
    const data = await res.json()

    if (!data.ok) {
      console.error(
        '[slack create-channel] conversations.create error:',
        data.error
      )

      // Provide a user-friendly message for common errors
      let message = 'Failed to create Slack channel'
      if (data.error === 'name_taken')
        message = `A channel named #${name} already exists in Slack`
      else if (data.error === 'missing_scope')
        message =
          'Missing Slack permission. Add channels:manage (or groups:write for private) to your app scopes and reinstall.'
      else if (
        data.error === 'invalid_name' ||
        data.error === 'invalid_name_specials'
      )
        message = `"${name}" is not a valid Slack channel name`

      throw Object.assign(new Error(message), {
        status: 422,
        slackError: data.error,
      })
    }

    const channel = data.channel as {
      id: string
      name: string
      is_private: boolean
    }

    // Invite the current user (project owner) to the new channel (fire-and-forget)
    this._inviteUserToChannel(inviteClerkId, channel.id, token).catch(err =>
      console.error('[slack create-channel] invite user error:', err)
    )

    return {
      id: channel.id,
      name: `#${channel.name}`,
      private: channel.is_private,
    }
  },

  /**
   * Invite a single Clerk user (by clerkId) to a Slack channel.
   * Resolves their Slack user ID via primary email. Best-effort — never throws.
   */
  async _inviteUserToChannel(
    clerkId: string,
    channelId: string,
    token: string
  ): Promise<void> {
    try {
      const { createClerkClient } = await import('@clerk/nextjs/server')
      const clerk = createClerkClient({
        secretKey: process.env.CLERK_SECRET_KEY!,
      })
      const user = await clerk.users.getUser(clerkId)
      const email = user.emailAddresses.find(
        e => e.id === user.primaryEmailAddressId
      )?.emailAddress
      if (!email) return

      const lookupRes = await fetch(
        `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const lookupData = await lookupRes.json()
      if (!lookupData.ok) return
      const slackUserId: string = lookupData.user?.id
      if (!slackUserId) return

      const inviteRes = await fetch(
        'https://slack.com/api/conversations.invite',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: channelId, users: slackUserId }),
        }
      )
      const inviteData = await inviteRes.json()
      if (!inviteData.ok && inviteData.error !== 'already_in_channel') {
        console.error(
          '[slack create-channel] conversations.invite error:',
          inviteData.error
        )
      }
    } catch (err) {
      console.error('[slack create-channel] inviteUserToChannel error:', err)
    }
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
