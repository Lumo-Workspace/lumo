import { sentryRepository } from '@/lib/repositories/sentry.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    sentryIntegration: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    sentryProjectMapping: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    sentryIssueLink: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

const mocked = prisma as unknown as {
  sentryIntegration: {
    findUnique: jest.Mock
    upsert: jest.Mock
    delete: jest.Mock
    update: jest.Mock
  }
  sentryProjectMapping: {
    findMany: jest.Mock
    findUnique: jest.Mock
    create: jest.Mock
    delete: jest.Mock
  }
  sentryIssueLink: {
    findUnique: jest.Mock
    create: jest.Mock
  }
}

beforeEach(() => {
  const models = [
    mocked.sentryIntegration,
    mocked.sentryProjectMapping,
    mocked.sentryIssueLink,
  ]
  for (const model of models) {
    for (const fn of Object.values(model)) {
      fn.mockReset()
    }
  }
})

describe('sentryRepository', () => {
  describe('findIntegrationByWorkspace', () => {
    it('queries by workspaceId with safe selection', async () => {
      mocked.sentryIntegration.findUnique.mockResolvedValue({
        id: 'int1',
        orgSlug: 'acme',
        lastWebhookAt: null,
      })
      const result = await sentryRepository.findIntegrationByWorkspace('ws1')
      expect(mocked.sentryIntegration.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: 'ws1' },
        select: {
          id: true,
          orgSlug: true,
          lastWebhookAt: true,
          installedBy: true,
        },
      })
      expect(result?.orgSlug).toBe('acme')
    })
  })

  describe('findIntegrationByOrgSlug', () => {
    it('returns id + clientSecret + workspaceId for signature check', async () => {
      mocked.sentryIntegration.findUnique.mockResolvedValue({
        id: 'int1',
        workspaceId: 'ws1',
        clientSecret: 'encrypted',
      })
      const result = await sentryRepository.findIntegrationByOrgSlug('acme')
      expect(mocked.sentryIntegration.findUnique).toHaveBeenCalledWith({
        where: { orgSlug: 'acme' },
        select: { id: true, workspaceId: true, clientSecret: true },
      })
      expect(result?.id).toBe('int1')
    })
  })

  describe('upsertIntegration', () => {
    it('upserts by workspaceId with encrypted secret', async () => {
      mocked.sentryIntegration.upsert.mockResolvedValue({ id: 'int1' })
      await sentryRepository.upsertIntegration({
        workspaceId: 'ws1',
        installedBy: 'mem1',
        orgSlug: 'acme',
        clientSecret: 'enc',
      })
      const arg = mocked.sentryIntegration.upsert.mock.calls[0][0]
      expect(arg.where).toEqual({ workspaceId: 'ws1' })
      expect(arg.create.orgSlug).toBe('acme')
      expect(arg.update.clientSecret).toBe('enc')
    })
  })

  describe('findMappingByProjectSlug', () => {
    it('queries the composite unique index', async () => {
      mocked.sentryProjectMapping.findUnique.mockResolvedValue({
        id: 'map1',
        projectId: 'proj1',
      })
      await sentryRepository.findMappingByProjectSlug('int1', 'frontend')
      expect(mocked.sentryProjectMapping.findUnique).toHaveBeenCalledWith({
        where: {
          integrationId_sentryProjectSlug: {
            integrationId: 'int1',
            sentryProjectSlug: 'frontend',
          },
        },
        select: { id: true, projectId: true, integrationId: true },
      })
    })
  })

  describe('findLink', () => {
    it('queries the link composite unique index', async () => {
      mocked.sentryIssueLink.findUnique.mockResolvedValue({
        id: 'link1',
        taskId: 'task1',
      })
      await sentryRepository.findLink('int1', 'iss1')
      expect(mocked.sentryIssueLink.findUnique).toHaveBeenCalledWith({
        where: {
          integrationId_sentryIssueId: {
            integrationId: 'int1',
            sentryIssueId: 'iss1',
          },
        },
        select: { id: true, taskId: true },
      })
    })
  })

  describe('markWebhookReceived', () => {
    it('updates lastWebhookAt', async () => {
      mocked.sentryIntegration.update.mockResolvedValue({})
      await sentryRepository.markWebhookReceived('int1')
      expect(mocked.sentryIntegration.update).toHaveBeenCalledWith({
        where: { id: 'int1' },
        data: { lastWebhookAt: expect.any(Date) },
        select: { id: true },
      })
    })
  })
})
