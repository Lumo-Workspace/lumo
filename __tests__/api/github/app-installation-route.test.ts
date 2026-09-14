/**
 * @jest-environment node
 *
 * LUM-741 follow-up: the App installation is a shared workspace asset — it is
 * what managed security scanning clones with — so removing it is owner-only,
 * like disconnecting Slack. Workspace membership alone (which is all
 * requireWorkspaceByUrl proves) would let any member switch scanning off for
 * the whole team. Reading the status stays open to members.
 */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  requireWorkspaceMember: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireWorkspaceByUrl: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  githubAppInstallationRepository: {
    findByWorkspace: jest.fn(),
    findStatusByWorkspace: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/github', () => ({
  fetchAppInstallation: jest.fn(),
  fetchInstallationRepositories: jest.fn(),
  deleteAppInstallation: jest.fn(),
}))

import { GET, DELETE } from '@/app/api/github/app/installation/route'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { githubAppInstallationRepository } from '@/lib/repositories'
import { deleteAppInstallation } from '@/lib/integrations/github'

const mockRequireAuth = requireAuth as jest.Mock
const mockRequireMember = requireWorkspaceMember as jest.Mock
const mockRequireWorkspace = requireWorkspaceByUrl as jest.Mock
const repo = githubAppInstallationRepository as unknown as {
  [K in keyof typeof githubAppInstallationRepository]: jest.Mock
}

function req() {
  const { NextRequest } = jest.requireActual('next/server')
  return new NextRequest(
    'http://localhost/api/github/app/installation?workspaceUrl=acme'
  )
}

describe('/api/github/app/installation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRequireAuth.mockResolvedValue({ userId: 'clerk_1' })
    mockRequireWorkspace.mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm1' },
      workspace: { slug: 'acme' },
    })
    repo.findByWorkspace.mockResolvedValue({
      workspaceId: 'w1',
      installationId: 555,
    })
  })

  describe('DELETE', () => {
    it('refuses a non-owner member with 403 and removes nothing', async () => {
      mockRequireMember.mockResolvedValue({ id: 'm1', role: 'MEMBER' })

      const res = await DELETE(req())

      expect(res.status).toBe(403)
      expect(repo.delete).not.toHaveBeenCalled()
      expect(deleteAppInstallation).not.toHaveBeenCalled()
    })

    it('lets an owner uninstall', async () => {
      mockRequireMember.mockResolvedValue({ id: 'm1', role: 'OWNER' })

      const res = await DELETE(req())

      expect(res.status).toBe(200)
      expect(deleteAppInstallation).toHaveBeenCalledWith(555)
      expect(repo.delete).toHaveBeenCalledWith('w1')
    })

    it('propagates the membership check failure', async () => {
      const { NextResponse } = jest.requireActual('next/server')
      mockRequireMember.mockResolvedValue(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      )

      const res = await DELETE(req())

      expect(res.status).toBe(403)
      expect(repo.delete).not.toHaveBeenCalled()
    })
  })

  describe('GET', () => {
    it('reports installation status to any workspace member', async () => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        createdAt: new Date(),
      })

      const res = await GET(req())

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual(
        expect.objectContaining({ installed: true, accountLogin: 'acme-inc' })
      )
      // Reading status must not require the owner role.
      expect(mockRequireMember).not.toHaveBeenCalled()
    })
  })
})
