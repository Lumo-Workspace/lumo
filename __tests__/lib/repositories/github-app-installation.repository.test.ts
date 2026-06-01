/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    gitHubAppInstallation: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { prisma } from '@/lib/db/prisma'

const prismaMock = prisma as unknown as {
  gitHubAppInstallation: {
    findUnique: jest.Mock
    upsert: jest.Mock
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
      select: { id: true, workspaceId: true, installationId: true },
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
})
