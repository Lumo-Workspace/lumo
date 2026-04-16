import { encrypt, decrypt } from '@/lib/crypto'
import { sentryRepository } from '@/lib/repositories/sentry.repository'

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
}

// Unused in this task, kept for later tasks that use handleWebhook:
void decrypt
