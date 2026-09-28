/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => {
  const gitHubAppInstallation = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  }
  return { prisma: { gitHubAppInstallation } }
})

import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { prisma } from '@/lib/db/prisma'

const prismaMock = prisma as unknown as {
  gitHubAppInstallation: {
    findUnique: jest.Mock
    findMany: jest.Mock
    upsert: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
    delete: jest.Mock
  }
}

beforeEach(() => jest.clearAllMocks())

describe('githubAppInstallationRepository', () => {
  it('findByWorkspace returns the row scoped by workspaceId', async () => {
    prismaMock.gitHubAppInstallation.findUnique.mockResolvedValue({
      id: 'gai_1',
      workspaceId: 'ws_1',
      installationId: 42,
    })

    const row = await githubAppInstallationRepository.findByWorkspace('ws_1')

    expect(prismaMock.gitHubAppInstallation.findUnique).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1' },
      select: {
        id: true,
        workspaceId: true,
        installationId: true,
        repositories: true,
      },
    })
    expect(row?.installationId).toBe(42)
  })

  it('findByWorkspace returns null when absent', async () => {
    prismaMock.gitHubAppInstallation.findUnique.mockResolvedValue(null)
    const row = await githubAppInstallationRepository.findByWorkspace('ws_x')
    expect(row).toBeNull()
  })

  it('upsert writes create + update payloads keyed by workspaceId', async () => {
    prismaMock.gitHubAppInstallation.upsert.mockResolvedValue({ id: 'gai_1' })

    await githubAppInstallationRepository.upsert({
      workspaceId: 'ws_1',
      installationId: 42,
      accountLogin: 'acme',
      accountType: 'Organization',
      repositories: ['acme/web'],
      installedBy: 'mem_1',
    })

    expect(prismaMock.gitHubAppInstallation.upsert).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1' },
      create: {
        workspaceId: 'ws_1',
        installationId: 42,
        accountLogin: 'acme',
        accountType: 'Organization',
        repositories: ['acme/web'],
        installedBy: 'mem_1',
        verifierLogin: null,
      },
      update: {
        installationId: 42,
        accountLogin: 'acme',
        accountType: 'Organization',
        repositories: ['acme/web'],
      },
    })
  })

  it('delete removes by workspaceId', async () => {
    prismaMock.gitHubAppInstallation.delete.mockResolvedValue({ id: 'gai_1' })
    await githubAppInstallationRepository.delete('ws_1')
    expect(prismaMock.gitHubAppInstallation.delete).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1' },
    })
  })

  describe('LUM-882 verifier access recheck', () => {
    it('upsert with a verifier login records it and clears stale recheck state', async () => {
      prismaMock.gitHubAppInstallation.upsert.mockResolvedValue({ id: 'gai_1' })
      await githubAppInstallationRepository.upsert({
        workspaceId: 'ws_1',
        installationId: 42,
        repositories: ['acme/web'],
        verifierLogin: 'octo',
      })
      const arg = prismaMock.gitHubAppInstallation.upsert.mock.calls[0][0]
      expect(arg.create.verifierLogin).toBe('octo')
      expect(arg.update).toMatchObject({
        verifierLogin: 'octo',
        accessRemovedCount: 0,
        accessRemovedAt: null,
        accessCheckCursor: null,
      })
    })

    it('recordVerification replaces the list and resets the removal notice', async () => {
      await githubAppInstallationRepository.recordVerification(
        'ws_1',
        ['acme/web'],
        'octo'
      )
      expect(prismaMock.gitHubAppInstallation.update).toHaveBeenCalledWith({
        where: { workspaceId: 'ws_1' },
        data: {
          repositories: ['acme/web'],
          verifierLogin: 'octo',
          accessRemovedCount: 0,
          accessRemovedAt: null,
          accessCheckCursor: null,
        },
        select: { id: true },
      })
    })

    it('findAllWithVerifier only returns rows with a verifier login', async () => {
      prismaMock.gitHubAppInstallation.findMany.mockResolvedValue([])
      await githubAppInstallationRepository.findAllWithVerifier()
      expect(
        prismaMock.gitHubAppInstallation.findMany.mock.calls[0][0].where
      ).toEqual({ verifierLogin: { not: null } })
    })

    it('findRecheckState selects the narrowed fields and the version', async () => {
      prismaMock.gitHubAppInstallation.findUnique.mockResolvedValue(null)
      await githubAppInstallationRepository.findRecheckState('ws_1')
      expect(prismaMock.gitHubAppInstallation.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: 'ws_1' },
        select: {
          repositories: true,
          verifierLogin: true,
          accessRemovedCount: true,
          updatedAt: true,
        },
      })
    })

    it('updateRecheckIfUnchanged writes only the version it was computed from', async () => {
      const version = new Date('2026-09-27T00:00:00Z')
      prismaMock.gitHubAppInstallation.updateMany.mockResolvedValue({
        count: 1,
      })
      const written =
        await githubAppInstallationRepository.updateRecheckIfUnchanged(
          'ws_1',
          { verifierLogin: 'octo', updatedAt: version },
          { repositories: ['acme/api'], accessCheckCursor: null }
        )
      expect(written).toBe(true)
      expect(prismaMock.gitHubAppInstallation.updateMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws_1',
          verifierLogin: 'octo',
          updatedAt: version,
        },
        data: { repositories: ['acme/api'], accessCheckCursor: null },
      })
    })

    it('updateRecheckIfUnchanged reports a lost race', async () => {
      prismaMock.gitHubAppInstallation.updateMany.mockResolvedValue({
        count: 0,
      })
      expect(
        await githubAppInstallationRepository.updateRecheckIfUnchanged(
          'ws_1',
          { verifierLogin: 'octo', updatedAt: new Date() },
          { repositories: [] }
        )
      ).toBe(false)
    })
  })
})
