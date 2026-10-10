/**
 * @jest-environment node
 *
 * LUM-741 follow-up: the App installation is a shared workspace asset — it is
 * what managed security scanning clones with — so removing it is owner-only,
 * like disconnecting Slack. Workspace membership alone (which is all
 * requireWorkspaceByUrl proves) would let any member switch scanning off for
 * the whole team. Reading the status stays open to members; the names of
 * repositories nobody has confirmed are owner-only (LUM-883).
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
    // LUM-875: uninstall checks whether another workspace shares the id.
    findAllByInstallationId: jest.fn().mockResolvedValue([]),
    deleteForWorkspace: jest.fn(),
  },
}))
// LUM-1061: the security plugin scrubs scan code through the repository
// module directly, not through the barrel.
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    scrubCodeForWorkspace: jest
      .fn()
      .mockResolvedValue({ scans: 0, findings: 0 }),
  },
}))
// LUM-879: every workspace code scrub also strips code from PR-mirrored
// comments; this route test does not exercise that step.
jest.mock('@/lib/services/pr-comment-code-scrub.service', () => ({
  scrubMirroredCommentCode: jest
    .fn()
    .mockResolvedValue({ comments: 0, jobs: 0 }),
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
import {
  deleteAppInstallation,
  fetchInstallationRepositories,
} from '@/lib/integrations/github'

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
      expect(repo.deleteForWorkspace).not.toHaveBeenCalled()
      expect(deleteAppInstallation).not.toHaveBeenCalled()
    })

    it('lets an owner uninstall', async () => {
      mockRequireMember.mockResolvedValue({ id: 'm1', role: 'OWNER' })

      const res = await DELETE(req())

      expect(res.status).toBe(200)
      expect(deleteAppInstallation).toHaveBeenCalledWith(555)
      expect(repo.deleteForWorkspace).toHaveBeenCalledWith('w1')
    })

    it('propagates the membership check failure', async () => {
      const { NextResponse } = jest.requireActual('next/server')
      mockRequireMember.mockResolvedValue(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      )

      const res = await DELETE(req())

      expect(res.status).toBe(403)
      expect(repo.deleteForWorkspace).not.toHaveBeenCalled()
    })
  })

  describe('GET', () => {
    beforeEach(() => {
      repo.findStatusByWorkspace.mockResolvedValue({
        installationId: 555,
        accountLogin: 'acme-inc',
        accountType: 'Organization',
        repositories: ['acme-inc/web'],
        createdAt: new Date(),
      })
      ;(fetchInstallationRepositories as jest.Mock).mockResolvedValue([
        'acme-inc/web',
        'acme-inc/payroll',
      ])
    })

    it('reports installation status to any workspace member', async () => {
      mockRequireMember.mockResolvedValue({ id: 'm1', role: 'MEMBER' })

      const res = await GET(req())

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual(
        expect.objectContaining({ installed: true, accountLogin: 'acme-inc' })
      )
    })

    // LUM-883: repositories nobody confirmed are not every member's to read.
    it('shows pending repository names to owners only', async () => {
      mockRequireMember.mockResolvedValue({ id: 'm1', role: 'MEMBER' })
      const memberBody = await (await GET(req())).json()
      expect(memberBody).not.toHaveProperty('pendingRepositories')
      expect(JSON.stringify(memberBody)).not.toContain('payroll')

      mockRequireMember.mockResolvedValue({ id: 'm1', role: 'OWNER' })
      const ownerBody = await (await GET(req())).json()
      expect(ownerBody.pendingRepositories).toEqual(['acme-inc/payroll'])
    })

    it('propagates the membership check failure', async () => {
      const { NextResponse } = jest.requireActual('next/server')
      mockRequireMember.mockResolvedValue(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      )

      const res = await GET(req())

      expect(res.status).toBe(403)
      expect(repo.findStatusByWorkspace).not.toHaveBeenCalled()
    })
  })
})
