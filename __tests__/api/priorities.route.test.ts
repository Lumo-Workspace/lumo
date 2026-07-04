/**
 * @jest-environment node
 *
 * LUM-662: POST /api/priorities appends a team-scoped priority (never mutates
 * prior rows) and Zod rejects a blank statement with 400. GET returns the
 * current declaration + full append history.
 */
import { GET, POST } from '@/app/api/priorities/route'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest
    .fn()
    .mockResolvedValue({ workspaceId: 'w1', memberId: 'm1' }),
}))
jest.mock('@/lib/repositories', () => ({
  priorityRepository: { findDefaultTeamId: jest.fn() },
}))
jest.mock('@/lib/services', () => ({
  priorityService: { declarePriority: jest.fn(), listHistory: jest.fn() },
}))

import { priorityRepository } from '@/lib/repositories'
import { priorityService } from '@/lib/services'

const findDefaultTeamId = priorityRepository.findDefaultTeamId as jest.Mock
const declarePriority = priorityService.declarePriority as jest.Mock
const listHistory = priorityService.listHistory as jest.Mock

function postReq(body: unknown): Request {
  return new Request('http://x/api/priorities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const t1 = new Date('2026-01-01T00:00:00.000Z')
const t2 = new Date('2026-02-01T00:00:00.000Z')
const row = (id: string, statement: string, effectiveFrom: Date) => ({
  id,
  teamId: 'team1',
  workspaceId: 'w1',
  statement,
  effectiveFrom,
  declaredByMemberId: 'm1',
  createdAt: effectiveFrom,
})

beforeEach(() => {
  jest.clearAllMocks()
  findDefaultTeamId.mockResolvedValue('team1')
})

describe('POST /api/priorities', () => {
  it('appends a priority scoped to the caller team and returns 201', async () => {
    declarePriority.mockResolvedValue(row('p1', 'ship it', t1))

    const res = await POST(postReq({ statement: 'ship it' }))
    expect(res.status).toBe(201)

    // Team resolved from the caller's workspace; append carries caller identity.
    expect(findDefaultTeamId).toHaveBeenCalledWith('w1')
    expect(declarePriority).toHaveBeenCalledWith('team1', 'w1', 'm1', {
      statement: 'ship it',
    })

    const body = (await res.json()) as {
      priority: { statement: string; effectiveFrom: string }
    }
    expect(body.priority.statement).toBe('ship it')
    expect(body.priority.effectiveFrom).toBe(t1.toISOString())
  })

  it('rejects a blank statement with 400 and never calls the service', async () => {
    const res = await POST(postReq({ statement: '   ' }))
    expect(res.status).toBe(400)
    expect(declarePriority).not.toHaveBeenCalled()
  })

  it('rejects a missing statement with 400', async () => {
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
    expect(declarePriority).not.toHaveBeenCalled()
  })

  it('404s when the workspace has no default team', async () => {
    findDefaultTeamId.mockResolvedValue(null)
    const res = await POST(postReq({ statement: 'ship it' }))
    expect(res.status).toBe(404)
    expect(declarePriority).not.toHaveBeenCalled()
  })
})

describe('GET /api/priorities', () => {
  it('returns the latest as current and both rows in history, newest first', async () => {
    listHistory.mockResolvedValue([
      row('p2', 'second', t2),
      row('p1', 'first', t1),
    ])

    const res = await GET(new Request('http://x/api/priorities'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      current: { id: string; statement: string } | null
      history: { id: string; statement: string }[]
    }
    expect(body.current?.id).toBe('p2')
    expect(body.current?.statement).toBe('second')
    expect(body.history.map(h => h.id)).toEqual(['p2', 'p1'])
    // The older row is present and unchanged.
    expect(body.history[1]?.statement).toBe('first')
  })

  it('returns null current + empty history when none declared', async () => {
    listHistory.mockResolvedValue([])
    const res = await GET(new Request('http://x/api/priorities'))
    const body = (await res.json()) as { current: unknown; history: unknown[] }
    expect(body.current).toBeNull()
    expect(body.history).toEqual([])
  })
})
