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
    deleteMany: jest.fn(),
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
    deleteMany: jest.Mock
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
        verifierGithubId: null,
        verifiedAt: null,
      },
      update: {
        installationId: 42,
        accountLogin: 'acme',
        accountType: 'Organization',
        repositories: ['acme/web'],
      },
    })
  })

  it('deleteForWorkspace removes by workspaceId, idempotently', async () => {
    prismaMock.gitHubAppInstallation.deleteMany.mockResolvedValue({ count: 1 })
    await githubAppInstallationRepository.deleteForWorkspace('ws_1')
    expect(prismaMock.gitHubAppInstallation.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1' },
    })
  })

  it('findInstallationIdsWithoutVerifier lists installations of unverified rows', async () => {
    prismaMock.gitHubAppInstallation.findMany.mockResolvedValue([
      { installationId: 7 },
      { installationId: 9 },
    ])
    await expect(
      githubAppInstallationRepository.findInstallationIdsWithoutVerifier()
    ).resolves.toEqual([7, 9])
    expect(prismaMock.gitHubAppInstallation.findMany).toHaveBeenCalledWith({
      where: { OR: [{ verifierLogin: null }, { verifiedAt: null }] },
      distinct: ['installationId'],
      select: { installationId: true },
    })
  })

  it('deleteForWorkspace with an installation id leaves a re-bound row alone', async () => {
    prismaMock.gitHubAppInstallation.deleteMany.mockResolvedValue({ count: 0 })
    await githubAppInstallationRepository.deleteForWorkspace('ws_1', 42)
    expect(prismaMock.gitHubAppInstallation.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', installationId: 42 },
    })
  })

  describe('LUM-882 verifier access recheck', () => {
    it('upsert with a verifier login records it and clears stale recheck state', async () => {
      prismaMock.gitHubAppInstallation.upsert.mockResolvedValue({ id: 'gai_1' })
      await githubAppInstallationRepository.upsert({
        workspaceId: 'ws_1',
        installationId: 42,
        repositories: ['acme/web'],
        verifier: { login: 'octo', githubId: 7 },
      })
      const arg = prismaMock.gitHubAppInstallation.upsert.mock.calls[0][0]
      expect(arg.create.verifierLogin).toBe('octo')
      expect(arg.create.verifierGithubId).toBe(7)
      expect(arg.create.verifiedAt).toBeInstanceOf(Date)
      expect(arg.update.verifiedAt).toBeInstanceOf(Date)
      expect(arg.update).toMatchObject({
        verifierLogin: 'octo',
        verifierGithubId: 7,
        accessRemovedReason: null,
        accessRemovedCount: 0,
        accessRemovedAt: null,
        accessCheckCursor: null,
      })
    })

    it('recordVerification replaces the list and resets the removal notice', async () => {
      await githubAppInstallationRepository.recordVerification(
        'ws_1',
        ['acme/web'],
        { login: 'octo', githubId: 7 }
      )
      expect(prismaMock.gitHubAppInstallation.update).toHaveBeenCalledWith({
        where: { workspaceId: 'ws_1' },
        data: {
          repositories: ['acme/web'],
          verifierLogin: 'octo',
          verifierGithubId: 7,
          verifiedAt: expect.any(Date),
          accessRemovedCount: 0,
          accessRemovedReason: null,
          accessRemovedAt: null,
          accessCheckCursor: null,
        },
        select: { id: true },
      })
    })

    it('findAllWithVerifier only returns verified rows, longest-waiting first', async () => {
      prismaMock.gitHubAppInstallation.findMany.mockResolvedValue([])
      await githubAppInstallationRepository.findAllWithVerifier()
      const arg = prismaMock.gitHubAppInstallation.findMany.mock.calls[0][0]
      expect(arg.where).toEqual({
        verifierLogin: { not: null },
        verifiedAt: { not: null },
      })
      expect(arg.orderBy[0]).toEqual({
        accessCheckedAt: { sort: 'asc', nulls: 'first' },
      })
    })

    it('findRecheckState selects the narrowed fields and the version', async () => {
      prismaMock.gitHubAppInstallation.findUnique.mockResolvedValue(null)
      await githubAppInstallationRepository.findRecheckState('ws_1')
      expect(prismaMock.gitHubAppInstallation.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: 'ws_1' },
        select: {
          repositories: true,
          verifierLogin: true,
          verifiedAt: true,
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
          { verifiedAt: version, updatedAt: version },
          { repositories: ['acme/api'], accessCheckCursor: null }
        )
      expect(written).toBe(true)
      expect(prismaMock.gitHubAppInstallation.updateMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws_1',
          verifiedAt: version,
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
          { verifiedAt: new Date(), updatedAt: new Date() },
          { repositories: [] }
        )
      ).toBe(false)
    })
  })
})
