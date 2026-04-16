/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {},
}))
jest.mock('@/lib/repositories/sentry.repository', () => ({
  sentryRepository: {
    findIntegrationByWorkspace: jest.fn(),
    upsertIntegration: jest.fn(),
    deleteIntegration: jest.fn(),
  },
}))
jest.mock('@/lib/crypto', () => ({
  encrypt: jest.fn((s: string) => `enc(${s})`),
  decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
}))

import { sentryService } from '@/lib/services/sentry.service'
import { sentryRepository } from '@/lib/repositories/sentry.repository'
import { encrypt } from '@/lib/crypto'

describe('sentryService status/connect/disconnect', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('getIntegrationStatus', () => {
    it('returns { connected: false } when no integration', async () => {
      ;(
        sentryRepository.findIntegrationByWorkspace as jest.Mock
      ).mockResolvedValue(null)
      const status = await sentryService.getIntegrationStatus('ws1')
      expect(status).toEqual({ connected: false })
    })

    it('returns orgSlug and lastWebhookAt when connected', async () => {
      ;(
        sentryRepository.findIntegrationByWorkspace as jest.Mock
      ).mockResolvedValue({
        id: 'int1',
        orgSlug: 'acme',
        lastWebhookAt: new Date('2026-04-16T10:00:00Z'),
        installedBy: 'mem1',
      })
      const status = await sentryService.getIntegrationStatus('ws1')
      expect(status).toMatchObject({ connected: true, orgSlug: 'acme' })
    })
  })

  describe('connectIntegration', () => {
    it('rejects non-OWNER with 403', async () => {
      await expect(
        sentryService.connectIntegration('ws1', 'mem1', 'MEMBER', {
          orgSlug: 'acme',
          clientSecret: 'plaintext',
        })
      ).rejects.toMatchObject({ status: 403 })
      expect(sentryRepository.upsertIntegration).not.toHaveBeenCalled()
    })

    it('encrypts clientSecret before upserting', async () => {
      ;(sentryRepository.upsertIntegration as jest.Mock).mockResolvedValue({
        id: 'int1',
      })
      await sentryService.connectIntegration('ws1', 'mem1', 'OWNER', {
        orgSlug: 'acme',
        clientSecret: 'plaintext',
      })
      expect(encrypt).toHaveBeenCalledWith('plaintext')
      expect(sentryRepository.upsertIntegration).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        installedBy: 'mem1',
        orgSlug: 'acme',
        clientSecret: 'enc(plaintext)',
      })
    })
  })

  describe('disconnectIntegration', () => {
    it('rejects non-OWNER with 403', async () => {
      await expect(
        sentryService.disconnectIntegration('ws1', 'MEMBER')
      ).rejects.toMatchObject({ status: 403 })
    })

    it('calls deleteIntegration for OWNER', async () => {
      await sentryService.disconnectIntegration('ws1', 'OWNER')
      expect(sentryRepository.deleteIntegration).toHaveBeenCalledWith('ws1')
    })
  })
})
