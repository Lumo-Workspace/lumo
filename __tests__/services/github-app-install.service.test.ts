/**
 * @jest-environment node
 *
 * LUM-741: what the App-level webhook events and the install callback actually
 * do to the GitHubAppInstallation row.
 */
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    upsert: jest.fn(),
    findByWorkspace: jest.fn(),
    findStatusByWorkspace: jest.fn(),
    findByInstallationId: jest.fn(),
    updateRepositories: jest.fn(),
    delete: jest.fn(),
    deleteByInstallationId: jest.fn().mockResolvedValue({ count: 1 }),
  },
}))
jest.mock('@/lib/integrations/github', () => ({
  fetchAppInstallation: jest.fn(),
  fetchInstallationRepositories: jest.fn(),
  deleteAppInstallation: jest.fn(),
}))

import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  fetchAppInstallation,
  fetchInstallationRepositories,
  deleteAppInstallation,
} from '@/lib/integrations/github'

type MockedRepo = {
  [K in keyof typeof githubAppInstallationRepository]: jest.Mock
}
const repo = githubAppInstallationRepository as unknown as MockedRepo

describe('githubAppInstallService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    repo.deleteByInstallationId.mockResolvedValue({ count: 1 })
    ;(fetchAppInstallation as jest.Mock).mockResolvedValue({
      accountLogin: 'acme-inc',
      accountType: 'Organization',
    })
    ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
      'acme-inc/web',
    ])
  })

  describe('install', () => {
    it('stores the installation with the account and repositories read from GitHub', async () => {
      await githubAppInstallService.install({
        workspaceId: 'w1',
        memberId: 'm1',
        installationId: 42,
      })

      expect(repo.upsert).toHaveBeenCalledWith({
        workspaceId: 'w1',
        installationId: 42,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        installedBy: 'm1',
      })
    })

    it('writes nothing when GitHub rejects the installation read', async () => {
      ;(fetchAppInstallation as jest.Mock).mockRejectedValue(new Error('404'))

      await expect(
        githubAppInstallService.install({
          workspaceId: 'w1',
          memberId: 'm1',
          installationId: 42,
        })
      ).rejects.toThrow('404')
      expect(repo.upsert).not.toHaveBeenCalled()
    })
  })

  describe('applyInstallationEvent', () => {
    it('updates the known workspace row on created', async () => {
      repo.findByInstallationId.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
        repositories: ['acme-inc/old'],
      })

      await githubAppInstallService.applyInstallationEvent({
        action: 'created',
        installation: {
          id: 555,
          account: { login: 'acme-inc', type: 'Organization' },
        },
        repositories: [{ full_name: 'acme-inc/web' }],
      })

      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'w1',
          installationId: 555,
          accountLogin: 'acme-inc',
          repositories: ['acme-inc/web'],
        })
      )
    })

    it('ignores an installation it has never seen instead of guessing a workspace', async () => {
      repo.findByInstallationId.mockResolvedValue(null)

      await githubAppInstallService.applyInstallationEvent({
        action: 'created',
        installation: { id: 999 },
      })

      expect(repo.upsert).not.toHaveBeenCalled()
    })

    it.each(['deleted', 'suspend'])('removes the row on %s', async action => {
      await githubAppInstallService.applyInstallationEvent({
        action,
        installation: { id: 555 },
      })

      expect(repo.deleteByInstallationId).toHaveBeenCalledWith(555)
      expect(repo.upsert).not.toHaveBeenCalled()
    })

    it('ignores a payload with no installation id', async () => {
      await githubAppInstallService.applyInstallationEvent({
        action: 'created',
      })

      expect(repo.deleteByInstallationId).not.toHaveBeenCalled()
      expect(repo.upsert).not.toHaveBeenCalled()
    })
  })

  describe('applyInstallationRepositoriesEvent', () => {
    it('adds and removes repositories without dropping the rest', async () => {
      repo.findByInstallationId.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
        repositories: ['acme-inc/web', 'acme-inc/legacy'],
      })

      await githubAppInstallService.applyInstallationRepositoriesEvent({
        action: 'added',
        installation: { id: 555 },
        repositories_added: [{ full_name: 'acme-inc/api' }],
        repositories_removed: [{ full_name: 'acme-inc/legacy' }],
      })

      expect(repo.updateRepositories).toHaveBeenCalledWith('w1', [
        'acme-inc/web',
        'acme-inc/api',
      ])
    })

    it('does nothing for an unknown installation', async () => {
      repo.findByInstallationId.mockResolvedValue(null)

      await githubAppInstallService.applyInstallationRepositoriesEvent({
        action: 'added',
        installation: { id: 999 },
        repositories_added: [{ full_name: 'x/y' }],
      })

      expect(repo.updateRepositories).not.toHaveBeenCalled()
    })
  })

  describe('uninstall', () => {
    it('refuses a non-owner and touches nothing', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })

      await expect(
        githubAppInstallService.uninstall('w1', 'MEMBER')
      ).rejects.toMatchObject({ status: 403 })
      expect(deleteAppInstallation).not.toHaveBeenCalled()
      expect(repo.delete).not.toHaveBeenCalled()
    })

    it('deletes the installation on GitHub and locally', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })

      await githubAppInstallService.uninstall('w1', 'OWNER')

      expect(deleteAppInstallation).toHaveBeenCalledWith(555)
      expect(repo.delete).toHaveBeenCalledWith('w1')
    })

    it('still drops the local row when GitHub refuses the delete', async () => {
      repo.findByWorkspace.mockResolvedValue({
        workspaceId: 'w1',
        installationId: 555,
      })
      ;(deleteAppInstallation as jest.Mock).mockRejectedValue(new Error('403'))

      await githubAppInstallService.uninstall('w1', 'OWNER')

      expect(repo.delete).toHaveBeenCalledWith('w1')
    })
  })

  describe('getStatus', () => {
    it('reports not installed when the workspace has no row', async () => {
      repo.findStatusByWorkspace.mockResolvedValue(null)

      expect(await githubAppInstallService.getStatus('w1')).toEqual({
        installed: false,
      })
    })

    it('reports the account and repository scope when installed', async () => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        createdAt: new Date(),
      })

      expect(await githubAppInstallService.getStatus('w1')).toEqual({
        installed: true,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
      })
    })
  })
})
