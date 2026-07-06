/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services', () => ({
  ideaService: { updateStatus: jest.fn(), updateStatement: jest.fn() },
}))
// LUM-680: the PATCH route resolves the acting actor for the timeline entry.
jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn(async () => 'actor-1'),
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { ideaService } from '@/lib/services'
import { PATCH } from '@/app/api/ideas/[id]/route'

const ID = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}

const patchReq = (b: unknown) =>
  new NextRequest('http://x/api/ideas/LUM-I8', {
    method: 'PATCH',
    body: JSON.stringify(b),
  })

const params = (id: string) => Promise.resolve({ id })

const IDEA = {
  id: 'i8',
  number: 8,
  identifier: 'LUM-I8',
  statement: 'ship it',
  status: 'DEVELOPING' as const,
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  createdAt: new Date(0),
}

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/ideas/[id]', () => {
  it('200 updates the idea status and returns it', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(ideaService.updateStatus as jest.Mock).mockResolvedValue(IDEA)

    const res = await PATCH(patchReq({ status: 'DEVELOPING' }), {
      params: params('LUM-I8'),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.idea.status).toBe('DEVELOPING')
    expect(ideaService.updateStatus).toHaveBeenCalledWith({
      workspaceId: 'w1',
      ideaRef: 'LUM-I8',
      status: 'DEVELOPING',
      actorId: 'actor-1',
    })
  })

  it('400 rejects an unknown status via Zod without calling the service', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    const res = await PATCH(patchReq({ status: 'ARCHIVED' }), {
      params: params('LUM-I8'),
    })
    expect(res.status).toBe(400)
    expect(ideaService.updateStatus).not.toHaveBeenCalled()
  })

  it('surfaces a service 400 (illegal transition)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(ideaService.updateStatus as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Cannot move LUM-I8 from DROPPED to CAPTURED'), {
        status: 400,
      })
    )
    const res = await PATCH(patchReq({ status: 'CAPTURED' }), {
      params: params('LUM-I8'),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Cannot move')
  })

  it('surfaces a service 404 (unknown idea)', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
    ;(ideaService.updateStatus as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Idea not found: LUM-I99'), { status: 404 })
    )
    const res = await PATCH(patchReq({ status: 'DROPPED' }), {
      params: params('LUM-I99'),
    })
    expect(res.status).toBe(404)
  })

  it('401 when unauthenticated', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await PATCH(patchReq({ status: 'DROPPED' }), {
      params: params('LUM-I8'),
    })
    expect(res.status).toBe(401)
    expect(ideaService.updateStatus).not.toHaveBeenCalled()
  })
})
