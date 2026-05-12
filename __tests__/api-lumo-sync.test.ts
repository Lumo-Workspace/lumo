/**
 * @jest-environment node
 */

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  requireWorkspaceMember: jest.fn(),
}))

jest.mock('@/lib/repositories/lumo-proposal.repository', () => ({
  lumoProposalRepository: {
    findById: jest.fn(),
  },
}))

jest.mock('@/lib/services/lumo-sync/lumo-sync.service', () => ({
  lumoSyncService: {
    sync: jest.fn(),
  },
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
    },
  },
}))

import { POST } from '@/app/api/lumo-proposals/[proposalId]/sync/route'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { lumoSyncService } from '@/lib/services/lumo-sync/lumo-sync.service'
import { prisma } from '@/lib/db/prisma'
import { NextResponse } from 'next/server'

function makeParams(proposalId: string): {
  params: Promise<{ proposalId: string }>
} {
  return { params: Promise.resolve({ proposalId }) }
}

const PROPOSAL = {
  id: 'prop-1',
  projectId: 'proj-1',
  taskId: 'task-1',
  status: 'PENDING',
  operations: [],
  summary: 'test summary',
  lumoMdSnapshot: null,
  prUrl: null,
  appliedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const PROJECT = { workspaceId: 'ws-1' }

const MEMBER = {
  id: 'mem-1',
  workspaceId: 'ws-1',
  clerkId: 'user-1',
  role: 'MEMBER',
}

const SYNC_RESULT = {
  prUrl: 'https://github.com/acme/repo/pull/42',
  prNumber: 42,
  branchName: 'lumo/sync-LUM-1-1234567890',
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/lumo-proposals/[proposalId]/sync', () => {
  it('returns 401 when not authenticated', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await POST(
      new Request('http://x/api/lumo-proposals/prop-1/sync', {
        method: 'POST',
      }),
      makeParams('prop-1')
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when proposal not found', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(lumoProposalRepository.findById as jest.Mock).mockResolvedValue(null)

    const res = await POST(
      new Request('http://x/api/lumo-proposals/missing/sync', {
        method: 'POST',
      }),
      makeParams('missing')
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Proposal not found')
  })

  it('returns prUrl on success', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(lumoProposalRepository.findById as jest.Mock).mockResolvedValue(PROPOSAL)
    ;(prisma.project.findUnique as jest.Mock).mockResolvedValue(PROJECT)
    ;(requireWorkspaceMember as jest.Mock).mockResolvedValue(MEMBER)
    ;(lumoSyncService.sync as jest.Mock).mockResolvedValue(SYNC_RESULT)

    const res = await POST(
      new Request('http://x/api/lumo-proposals/prop-1/sync', {
        method: 'POST',
      }),
      makeParams('prop-1')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.prUrl).toBe(SYNC_RESULT.prUrl)
    expect(body.prNumber).toBe(42)
    expect(lumoSyncService.sync).toHaveBeenCalledWith('prop-1', 'ws-1', 'mem-1')
  })

  it('returns 404 when project not found', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(lumoProposalRepository.findById as jest.Mock).mockResolvedValue(PROPOSAL)
    ;(prisma.project.findUnique as jest.Mock).mockResolvedValue(null)

    const res = await POST(
      new Request('http://x/api/lumo-proposals/prop-1/sync', {
        method: 'POST',
      }),
      makeParams('prop-1')
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Project not found')
  })

  it('returns 403 when user is not a workspace member', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(lumoProposalRepository.findById as jest.Mock).mockResolvedValue(PROPOSAL)
    ;(prisma.project.findUnique as jest.Mock).mockResolvedValue(PROJECT)
    ;(requireWorkspaceMember as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )

    const res = await POST(
      new Request('http://x/api/lumo-proposals/prop-1/sync', {
        method: 'POST',
      }),
      makeParams('prop-1')
    )
    expect(res.status).toBe(403)
  })

  it('forwards service error status codes', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'user-1' })
    ;(lumoProposalRepository.findById as jest.Mock).mockResolvedValue(PROPOSAL)
    ;(prisma.project.findUnique as jest.Mock).mockResolvedValue(PROJECT)
    ;(requireWorkspaceMember as jest.Mock).mockResolvedValue(MEMBER)
    ;(lumoSyncService.sync as jest.Mock).mockRejectedValue(
      Object.assign(new Error('GitHub not connected'), { status: 400 })
    )

    const res = await POST(
      new Request('http://x/api/lumo-proposals/prop-1/sync', {
        method: 'POST',
      }),
      makeParams('prop-1')
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('GitHub not connected')
  })
})
