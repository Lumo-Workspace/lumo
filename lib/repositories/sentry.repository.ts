import { prisma } from '@/lib/db/prisma'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpsertSentryIntegrationData {
  workspaceId: string
  installedBy: string
  orgSlug: string
  clientSecret: string // already encrypted
}

export interface CreateSentryProjectMappingData {
  integrationId: string
  sentryProjectSlug: string
  projectId: string
}

// ── Sentry Repository ───────────────────────────────────────────────────────

export const sentryRepository = {
  // ── Integration ──────────────────────────────────────────────────────

  /** Find integration by workspace id (status fields for settings UI). */
  async findIntegrationByWorkspace(workspaceId: string) {
    return prisma.sentryIntegration.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        orgSlug: true,
        lastWebhookAt: true,
        installedBy: true,
      },
    })
  },

  /** Find integration by Sentry org slug (for webhook signature verification). */
  async findIntegrationByOrgSlug(orgSlug: string) {
    return prisma.sentryIntegration.findUnique({
      where: { orgSlug },
      select: { id: true, workspaceId: true, clientSecret: true },
    })
  },

  /** Upsert integration (used when connecting/reconnecting). */
  async upsertIntegration(data: UpsertSentryIntegrationData) {
    return prisma.sentryIntegration.upsert({
      where: { workspaceId: data.workspaceId },
      create: {
        workspaceId: data.workspaceId,
        installedBy: data.installedBy,
        orgSlug: data.orgSlug,
        clientSecret: data.clientSecret,
      },
      update: {
        installedBy: data.installedBy,
        orgSlug: data.orgSlug,
        clientSecret: data.clientSecret,
      },
      select: { id: true },
    })
  },

  /** Delete integration by workspace id. */
  async deleteIntegration(workspaceId: string) {
    return prisma.sentryIntegration.delete({ where: { workspaceId } })
  },

  /** Record last webhook receipt time. */
  async markWebhookReceived(integrationId: string) {
    return prisma.sentryIntegration.update({
      where: { id: integrationId },
      data: { lastWebhookAt: new Date() },
      select: { id: true },
    })
  },

  // ── Mappings ────────────────────────────────────────────────────────

  /** List project mappings for an integration. */
  async listMappings(integrationId: string) {
    return prisma.sentryProjectMapping.findMany({
      where: { integrationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sentryProjectSlug: true,
        projectId: true,
        project: { select: { id: true, name: true } },
      },
    })
  },

  /** Find a mapping by Sentry project slug (webhook routing). */
  async findMappingByProjectSlug(
    integrationId: string,
    sentryProjectSlug: string
  ) {
    return prisma.sentryProjectMapping.findUnique({
      where: {
        integrationId_sentryProjectSlug: { integrationId, sentryProjectSlug },
      },
      select: { id: true, projectId: true, integrationId: true },
    })
  },

  /** Create a new Sentry project → Lumo project mapping. */
  async createMapping(data: CreateSentryProjectMappingData) {
    return prisma.sentryProjectMapping.create({
      data,
      select: {
        id: true,
        sentryProjectSlug: true,
        projectId: true,
      },
    })
  },

  /** Delete a mapping by id. */
  async deleteMapping(id: string) {
    return prisma.sentryProjectMapping.delete({ where: { id } })
  },

  /** Find a mapping by id, including integration workspace (for auth). */
  async findMappingWithIntegration(id: string) {
    return prisma.sentryProjectMapping.findUnique({
      where: { id },
      include: { integration: { select: { workspaceId: true } } },
    })
  },

  // ── Links ────────────────────────────────────────────────────────────

  /** Find an issue → task link (for deduplication). */
  async findLink(integrationId: string, sentryIssueId: string) {
    return prisma.sentryIssueLink.findUnique({
      where: {
        integrationId_sentryIssueId: { integrationId, sentryIssueId },
      },
      select: { id: true, taskId: true },
    })
  },

  /** Create an issue → task link. */
  async createLink(data: {
    integrationId: string
    sentryIssueId: string
    taskId: string
  }) {
    return prisma.sentryIssueLink.create({
      data,
      select: { id: true, taskId: true },
    })
  },

  // ── Project validation ───────────────────────────────────────────────

  /** Verify a project belongs to a workspace. */
  async findProjectInWorkspace(projectId: string, workspaceId: string) {
    return prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true },
    })
  },
}
