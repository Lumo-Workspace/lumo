/**
 * @jest-environment node
 *
 * LUM-944 — GET / DELETE /api/sessions/[sessionId]/raw-record: auth, the
 * session's workspace membership, Zod on the body, and the service's 403
 * passed through. The service runs for real over mocked repositories.
 */
import { NextRequest, NextResponse } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  requireWorkspaceMember: jest.fn(),
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/repositories/session-raw-record.repository', () => ({
  sessionRawRecordRepository: {
    findSessionOwner: jest.fn(),
    listFamilySessionIds: jest.fn(),
    findUnprunedEventIds: jest.fn(),
    findOpenCrossingEventIds: jest.fn(),
    countEvents: jest.fn(),
    findLatestUserDeletion: jest.fn(),
    findMemberClerkId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event-retention.repository', () => ({
  hookEventRetentionRepository: { prunePayloads: jest.fn() },
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  enrichClerkUsers: jest.fn(async () => new Map()),
}))

import { GET, DELETE } from '@/app/api/sessions/[sessionId]/raw-record/route'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { sessionRawRecordRepository } from '@/lib/repositories/session-raw-record.repository'
import { hookEventRetentionRepository } from '@/lib/repositories/hook-event-retention.repository'

const repo = sessionRawRecordRepository as unknown as Record<string, jest.Mock>
const prune = hookEventRetentionRepository.prunePayloads as jest.Mock
const params = { params: Promise.resolve({ sessionId: 's1' }) }

function asMember(id: string, role: 'OWNER' | 'MEMBER') {
  ;(requireWorkspaceMember as jest.Mock).mockResolvedValue({
    id,
    workspaceId: 'w1',
    role,
  })
}

const del = (body?: unknown) =>
  new NextRequest('http://x/api/sessions/s1/raw-record', {
    method: 'DELETE',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
  ;(sessionRepository.findWorkspaceId as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
  })
  repo.findSessionOwner!.mockResolvedValue({
    id: 's1',
    workspaceId: 'w1',
    workspaceMemberId: 'm_alice',
  })
  repo.listFamilySessionIds!.mockResolvedValue(['s1'])
  repo.findUnprunedEventIds!.mockResolvedValueOnce(['e1', 'e2', 'e3'])
  repo.findUnprunedEventIds!.mockResolvedValue([])
  repo.findOpenCrossingEventIds!.mockResolvedValue(['e2'])
  repo.countEvents!.mockResolvedValue({ total: 3, userDeleted: 0 })
  repo.findLatestUserDeletion!.mockResolvedValue(null)
  prune.mockImplementation(async (ids: string[]) => ids.length)
})

describe('raw-record route (LUM-944)', () => {
  it('session member deletes own session raw record through the route', async () => {
    asMember('m_alice', 'MEMBER')
    const res = await DELETE(del(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      deleted: 2,
      keptForCrossings: 1,
      done: true,
      cursor: null,
    })
    expect(prune.mock.calls[0]![0]).toEqual(['e1', 'e3'])
  })

  it('workspace owner deletes another member session raw record through the route', async () => {
    asMember('m_owner', 'OWNER')
    const res = await DELETE(del({ after: null }), params)
    expect(res.status).toBe(200)
    expect(prune.mock.calls[0]![1]).toMatchObject({
      _lumo_pruned: { reason: 'USER_DELETED', by: 'm_owner' },
    })
  })

  it('other member gets 403 from the route and nothing is cleared', async () => {
    asMember('m_bob', 'MEMBER')
    const res = await DELETE(del(), params)
    expect(res.status).toBe(403)
    expect(prune).not.toHaveBeenCalled()

    const status = await GET(new NextRequest('http://x'), params)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ canDelete: false })
  })

  it('non-member of the workspace gets 403, unknown session 404, signed-out 401', async () => {
    ;(requireWorkspaceMember as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )
    expect((await DELETE(del(), params)).status).toBe(403)
    ;(sessionRepository.findWorkspaceId as jest.Mock).mockResolvedValue(null)
    expect((await DELETE(del(), params)).status).toBe(404)
    ;(requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    expect((await GET(new NextRequest('http://x'), params)).status).toBe(401)
    expect(prune).not.toHaveBeenCalled()
  })

  it('rejects an invalid body with 400', async () => {
    asMember('m_alice', 'MEMBER')
    expect((await DELETE(del({ after: 42 }), params)).status).toBe(400)
    expect((await DELETE(del('{not json'), params)).status).toBe(400)
    expect(prune).not.toHaveBeenCalled()
  })

  it('GET reports the counts the dialog shows', async () => {
    asMember('m_alice', 'MEMBER')
    const res = await GET(new NextRequest('http://x'), params)
    expect(await res.json()).toEqual({
      canDelete: true,
      totalEvents: 3,
      deletable: 2,
      keptForCrossings: 1,
      deleted: 0,
      lastDeletion: null,
    })
  })
})
