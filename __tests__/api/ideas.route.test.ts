/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services', () => ({
  ideaService: { capture: jest.fn(), listUnprocessed: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { ideaService } from '@/lib/services'
import { POST, GET } from '@/app/api/ideas/route'

const ID = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}

const postReq = (b: unknown) =>
  new NextRequest('http://x/api/ideas', {
    method: 'POST',
    body: JSON.stringify(b),
  })
const getReq = () => new NextRequest('http://x/api/ideas', { method: 'GET' })

const IDEA = {
  id: 'i1',
  number: 42,
  identifier: 'LUM-I42',
  statement: 'ship the idea pool',
  status: 'CAPTURED' as const,
  sourceContext: null,
  sourceSessionId: 'sess-1',
  sourceTaskId: 'LUM-9',
  proposedByMemberId: 'm1',
  createdAt: new Date(0),
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/ideas', () => {
  it('201 creates a team idea with provenance and returns it', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(ideaService.capture as jest.Mock).mockResolvedValue(IDEA)

    const res = await POST(
      postReq({
        statement: 'ship the idea pool',
        sourceSessionId: 'sess-1',
        sourceTaskId: 'LUM-9',
      })
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.idea.identifier).toBe('LUM-I42')
    expect(ideaService.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        memberId: 'm1',
        input: expect.objectContaining({
          statement: 'ship the idea pool',
          sourceSessionId: 'sess-1',
          sourceTaskId: 'LUM-9',
        }),
      })
    )
  })

  it('201 captures with no bound task (sourceTaskId absent)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(ideaService.capture as jest.Mock).mockResolvedValue({
      ...IDEA,
      sourceTaskId: null,
    })

    const res = await POST(postReq({ statement: 'lone idea' }))

    expect(res.status).toBe(201)
    const passed = (ideaService.capture as jest.Mock).mock.calls[0][0]
    expect(passed.input.sourceTaskId).toBeUndefined()
  })

  it('400 rejects a blank statement via Zod', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    const res = await POST(postReq({ statement: '   ' }))
    expect(res.status).toBe(400)
    expect(ideaService.capture).not.toHaveBeenCalled()
  })

  it('400 rejects a missing statement via Zod', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    const res = await POST(postReq({ sourceContext: 'origin' }))
    expect(res.status).toBe(400)
    expect(ideaService.capture).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated (identity is a NextResponse)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(postReq({ statement: 'x' }))
    expect(res.status).toBe(401)
    expect(ideaService.capture).not.toHaveBeenCalled()
  })

  it('surfaces a service error status (404 no default team)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(ideaService.capture as jest.Mock).mockRejectedValue(
      Object.assign(new Error('No default team for workspace'), { status: 404 })
    )
    const res = await POST(postReq({ statement: 'x' }))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/ideas', () => {
  it('GET /api/ideas lists CAPTURED team ideas', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(ideaService.listUnprocessed as jest.Mock).mockResolvedValue([
      { ...IDEA, id: 'i1', number: 1, identifier: 'LUM-I1' },
      { ...IDEA, id: 'i2', number: 2, identifier: 'LUM-I2' },
    ])

    const res = await GET(getReq())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ideas).toHaveLength(2)
    expect(json.ideas.map((i: { identifier: string }) => i.identifier)).toEqual(
      ['LUM-I1', 'LUM-I2']
    )
    // Scoped to the caller's workspace only — the service resolves the caller
    // team from this and never crosses teams.
    expect(ideaService.listUnprocessed).toHaveBeenCalledWith({
      workspaceId: 'w1',
    })
  })

  it('401 when unauthenticated', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET(getReq())
    expect(res.status).toBe(401)
    expect(ideaService.listUnprocessed).not.toHaveBeenCalled()
  })
})
