import { encrypt, decrypt } from '@/lib/crypto'
import { sentryRepository } from '@/lib/repositories/sentry.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

export const sentryService = {
  async getIntegrationStatus(workspaceId: string) {
    const integration =
      await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) return { connected: false } as const
    return {
      connected: true,
      orgSlug: integration.orgSlug,
      lastWebhookAt: integration.lastWebhookAt,
      installedBy: integration.installedBy,
    } as const
  },

  async connectIntegration(
    workspaceId: string,
    memberId: string,
    role: string,
    data: { orgSlug: string; clientSecret: string }
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can connect Sentry'),
        { status: 403 }
      )
    }
    return sentryRepository.upsertIntegration({
      workspaceId,
      installedBy: memberId,
      orgSlug: data.orgSlug,
      clientSecret: encrypt(data.clientSecret),
    })
  },

  async disconnectIntegration(workspaceId: string, role: string) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can disconnect Sentry'),
        { status: 403 }
      )
    }
    return sentryRepository.deleteIntegration(workspaceId)
  },

  async listMappings(workspaceId: string) {
    const integration =
      await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Sentry not connected'), { status: 404 })
    }
    return sentryRepository.listMappings(integration.id)
  },

  async createMapping(
    workspaceId: string,
    role: string,
    data: { sentryProjectSlug: string; projectId: string }
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can manage Sentry mappings'),
        { status: 403 }
      )
    }
    const integration =
      await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Sentry not connected'), { status: 404 })
    }
    const project = await sentryRepository.findProjectInWorkspace(
      data.projectId,
      workspaceId
    )
    if (!project) {
      throw Object.assign(new Error('Project is not part of this workspace'), {
        status: 400,
      })
    }
    const existing = await sentryRepository.findMappingByProjectSlug(
      integration.id,
      data.sentryProjectSlug
    )
    if (existing) {
      throw Object.assign(new Error('This Sentry project is already mapped'), {
        status: 409,
      })
    }
    return sentryRepository.createMapping({
      integrationId: integration.id,
      sentryProjectSlug: data.sentryProjectSlug,
      projectId: data.projectId,
    })
  },

  async deleteMapping(workspaceId: string, role: string, mappingId: string) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can manage Sentry mappings'),
        { status: 403 }
      )
    }
    const mapping = await sentryRepository.findMappingWithIntegration(mappingId)
    if (!mapping || mapping.integration.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }
    return sentryRepository.deleteMapping(mappingId)
  },

  async _ensureBugTag(workspaceId: string): Promise<string> {
    const existing = await tagRepository.findByName(workspaceId, 'bug')
    if (existing) return existing.id
    try {
      const created = await tagRepository.create({
        workspaceId,
        name: 'bug',
        color: '#ef4444',
      })
      return created.id
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        const raced = await tagRepository.findByName(workspaceId, 'bug')
        if (raced) return raced.id
      }
      throw err
    }
  },

  async _resolveAssignee(
    workspaceId: string,
    emails: string[]
  ): Promise<string | null> {
    if (emails.length === 0) return null
    const actorIds = await memberRepository.findActorsByEmailInWorkspace(
      workspaceId,
      emails
    )
    return actorIds[0] ?? null
  },
}

// Unused in this task, kept for later tasks that use handleWebhook:
void decrypt
