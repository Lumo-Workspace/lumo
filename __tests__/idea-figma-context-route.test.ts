/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/idea-evidence-resolve', () => ({
  resolveIdeaRef: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  ideaFigmaLinkRepository: { findById: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaFigmaLinkRepository } from '@/lib/repositories'

import { GET as FIGMA_CONTEXT_GET } from '@/app/api/ideas/[id]/figma-links/[linkId]/context/route'

const identityMock = requireIdentity as jest.Mock
const resolveMock = resolveIdeaRef as jest.Mock
const findByIdMock = ideaFigmaLinkRepository.findById as jest.Mock

const IDENTITY = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}

const RESOLVED = { ideaId: 'i8', workspaceId: 'w1', teamId: 't1' }

const paramsP = (p: Record<string, string>) =>
  ({ params: Promise.resolve(p) }) as { params: Promise<never> }

beforeEach(() => {
  jest.clearAllMocks()
  identityMock.mockResolvedValue(IDENTITY)
  resolveMock.mockResolvedValue(RESOLVED)
})

describe('GET /api/ideas/[id]/figma-links/[linkId]/context', () => {
  it('200 returns link context for an in-team idea+link', async () => {
    findByIdMock.mockResolvedValue({
      id: 'fl_1',
      ideaId: 'i8',
      url: 'https://www.figma.com/file/abc123/Foo',
      fileKey: 'abc123',
      nodeId: '1:2',
      fileName: 'Foo',
      frameName: 'Frame 1',
      thumbnailUrl: 'https://thumb',
      thumbnailFetchedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSyncError: null,
    })

    const res = await FIGMA_CONTEXT_GET(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'fl_1' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metadata).toMatchObject({
      id: 'fl_1',
      url: 'https://www.figma.com/file/abc123/Foo',
      fileKey: 'abc123',
      nodeId: '1:2',
      fileName: 'Foo',
      frameName: 'Frame 1',
    })
    expect(body.designContextAvailable).toBe(false)
    expect(resolveMock).toHaveBeenCalledWith({
      workspaceId: 'w1',
      ideaRef: 'LUM-I8',
    })
    expect(findByIdMock).toHaveBeenCalledWith('fl_1')
  })

  it('401 when unauthenticated', async () => {
    identityMock.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await FIGMA_CONTEXT_GET(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'fl_1' })
    )
    expect(res.status).toBe(401)
  })

  it('404 when idea is cross-team or missing', async () => {
    resolveMock.mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await FIGMA_CONTEXT_GET(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'fl_1' })
    )
    expect(res.status).toBe(404)
    expect(findByIdMock).not.toHaveBeenCalled()
  })

  it('404 when the figma link does not exist', async () => {
    findByIdMock.mockResolvedValue(null)
    const res = await FIGMA_CONTEXT_GET(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'missing' })
    )
    expect(res.status).toBe(404)
  })

  it("404 when the link's ideaId does not match the resolved idea (cross-idea link)", async () => {
    findByIdMock.mockResolvedValue({
      id: 'fl_2',
      ideaId: 'other-idea',
      url: 'https://www.figma.com/file/abc123/Foo',
      fileKey: 'abc123',
      nodeId: '',
      fileName: 'Foo',
      frameName: null,
      thumbnailUrl: null,
      thumbnailFetchedAt: null,
      lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSyncError: null,
    })
    const res = await FIGMA_CONTEXT_GET(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'fl_2' })
    )
    expect(res.status).toBe(404)
  })
})
