import { prisma } from '@/lib/db/prisma'
import type { SlackEventType } from '@/lib/slack/types'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpsertSlackIntegrationData {
  workspaceId: string
  installedBy: string
  accessToken: string
  slackTeamId: string
  slackTeamName: string
  slackUserId: string
}

export interface CreateSlackChannelData {
  integrationId: string
  channelId: string
  channelName: string
  events: SlackEventType[]
  projectId: string
}

export interface UpdateSlackChannelData {
  channelId?: string
  channelName?: string
  events?: SlackEventType[]
}

// ── Slack Repository ────────────────────────────────────────────────────────

export const slackRepository = {
  /** Find integration by workspace id (status fields only). */
  async findIntegrationStatus(workspaceId: string) {
    return prisma.slackIntegration.findUnique({
      where: { workspaceId },
      select: { slackTeamName: true, slackUserId: true, slackTeamId: true },
    })
  },

  /** Find integration by workspace id (id + token for operations). */
  async findIntegrationWithToken(workspaceId: string) {
    return prisma.slackIntegration.findUnique({
      where: { workspaceId },
      select: { id: true, accessToken: true },
    })
  },

  /** Find integration id by workspace id. */
  async findIntegrationId(workspaceId: string) {
    return prisma.slackIntegration.findUnique({
      where: { workspaceId },
      select: { id: true },
    })
  },

  /** Upsert integration (used during OAuth callback). */
  async upsertIntegration(data: UpsertSlackIntegrationData) {
    return prisma.slackIntegration.upsert({
      where: { workspaceId: data.workspaceId },
      create: {
        workspaceId: data.workspaceId,
        installedBy: data.installedBy,
        accessToken: data.accessToken,
        slackTeamId: data.slackTeamId,
        slackTeamName: data.slackTeamName,
        slackUserId: data.slackUserId,
      },
      update: {
        installedBy: data.installedBy,
        accessToken: data.accessToken,
        slackTeamId: data.slackTeamId,
        slackTeamName: data.slackTeamName,
        slackUserId: data.slackUserId,
      },
    })
  },

  /** Delete integration by workspace id. */
  async deleteIntegration(workspaceId: string) {
    return prisma.slackIntegration.delete({ where: { workspaceId } })
  },

  // ── Channels ──────────────────────────────────────────────────────────

  /** Find a channel by integration + project. */
  async findChannelByProject(integrationId: string, projectId: string) {
    return prisma.slackChannel.findFirst({
      where: { integrationId, projectId },
      select: { id: true, channelId: true, channelName: true, events: true },
    })
  },

  /** Find a channel by id, including integration workspace. */
  async findChannelWithIntegration(id: string) {
    return prisma.slackChannel.findUnique({
      where: { id },
      include: { integration: { select: { workspaceId: true } } },
    })
  },

  /** Check if a channel already exists for integration + project. */
  async channelExistsForProject(integrationId: string, projectId: string) {
    const existing = await prisma.slackChannel.findFirst({
      where: { integrationId, projectId },
    })
    return !!existing
  },

  /** Create a new channel mapping. */
  async createChannel(data: CreateSlackChannelData) {
    return prisma.slackChannel.create({
      data: {
        integrationId: data.integrationId,
        channelId: data.channelId,
        channelName: data.channelName,
        events: data.events,
        projectId: data.projectId,
      },
      select: {
        id: true,
        channelId: true,
        channelName: true,
        events: true,
        projectId: true,
      },
    })
  },

  /** Update a channel's settings. */
  async updateChannel(id: string, data: UpdateSlackChannelData) {
    return prisma.slackChannel.update({
      where: { id },
      data,
      select: {
        id: true,
        channelId: true,
        channelName: true,
        events: true,
        projectId: true,
      },
    })
  },

  /** Delete a channel mapping by id. */
  async deleteChannel(id: string) {
    return prisma.slackChannel.delete({ where: { id } })
  },

  // ── Project validation ────────────────────────────────────────────────

  /** Verify a project belongs to a workspace. */
  async findProjectInWorkspace(projectId: string, workspaceId: string) {
    return prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    })
  },
}
