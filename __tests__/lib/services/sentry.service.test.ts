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
    listMappings: jest.fn(),
    findProjectInWorkspace: jest.fn(),
    findMappingByProjectSlug: jest.fn(),
    createMapping: jest.fn(),
    findMappingWithIntegration: jest.fn(),
    deleteMapping: jest.fn(),
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

describe('sentryService mappings CRUD', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(
      sentryRepository.findIntegrationByWorkspace as jest.Mock
    ).mockResolvedValue({ id: 'int1' })
    ;(sentryRepository.listMappings as jest.Mock).mockResolvedValue([])
    ;(sentryRepository.findProjectInWorkspace as jest.Mock).mockResolvedValue({
      id: 'p1',
    })
    ;(sentryRepository.findMappingByProjectSlug as jest.Mock).mockResolvedValue(
      null
    )
    ;(sentryRepository.createMapping as jest.Mock).mockResolvedValue({
      id: 'map1',
      sentryProjectSlug: 'frontend',
      projectId: 'p1',
    })
  })

  it('listMappings throws 404 when integration missing', async () => {
    ;(
      sentryRepository.findIntegrationByWorkspace as jest.Mock
    ).mockResolvedValue(null)
    await expect(sentryService.listMappings('ws1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('listMappings returns repository result', async () => {
    ;(sentryRepository.listMappings as jest.Mock).mockResolvedValue([
      { id: 'm1' },
    ])
    const result = await sentryService.listMappings('ws1')
    expect(result).toEqual([{ id: 'm1' }])
  })

  it('createMapping rejects non-OWNER with 403', async () => {
    await expect(
      sentryService.createMapping('ws1', 'MEMBER', {
        sentryProjectSlug: 'frontend',
        projectId: 'p1',
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('createMapping rejects when project not in workspace', async () => {
    ;(sentryRepository.findProjectInWorkspace as jest.Mock).mockResolvedValue(
      null
    )
    await expect(
      sentryService.createMapping('ws1', 'OWNER', {
        sentryProjectSlug: 'frontend',
        projectId: 'bad',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('createMapping rejects duplicates with 409', async () => {
    ;(sentryRepository.findMappingByProjectSlug as jest.Mock).mockResolvedValue(
      { id: 'existing' }
    )
    await expect(
      sentryService.createMapping('ws1', 'OWNER', {
        sentryProjectSlug: 'frontend',
        projectId: 'p1',
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('createMapping happy path creates mapping', async () => {
    const r = await sentryService.createMapping('ws1', 'OWNER', {
      sentryProjectSlug: 'frontend',
      projectId: 'p1',
    })
    expect(r.id).toBe('map1')
  })

  it('deleteMapping validates ownership', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'other-ws' },
    })
    await expect(
      sentryService.deleteMapping('ws1', 'OWNER', 'map1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deleteMapping rejects non-OWNER', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'ws1' },
    })
    await expect(
      sentryService.deleteMapping('ws1', 'MEMBER', 'map1')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('deleteMapping happy path deletes', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'ws1' },
    })
    await sentryService.deleteMapping('ws1', 'OWNER', 'map1')
    expect(sentryRepository.deleteMapping).toHaveBeenCalledWith('map1')
  })
})
