/**
 * @jest-environment node
 *
 * LUM-673: GET /api/initiatives (list) + GET /api/initiatives/[initiativeId]
 * (detail w/ lineage). This drives the REAL route → service → repository with
 * a mocked Prisma, so the team-scoping / no-leak guarantee is exercised for
 * real rather than mocked away at the service seam.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/team', () => ({ getDefaultTeam: jest.fn() }))
jest.mock('@/lib/db/prisma', () => {
  const initiative = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
  }
  return {
    prisma: {
      initiative,
      // Run the repository's create transaction against the same mock table.
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) =>
        cb({ initiative })
      ),
    },
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getDefaultTeam } from '@/lib/team'
import { prisma } from '@/lib/db/prisma'
import { GET as GET_LIST, POST } from '@/app/api/initiatives/route'
import { GET as GET_DETAIL } from '@/app/api/initiatives/[initiativeId]/route'

const mockIdentity = requireIdentity as jest.Mock
const mockTeam = getDefaultTeam as jest.Mock
const mockFindMany = prisma.initiative.findMany as jest.Mock
const mockFindUnique = prisma.initiative.findUnique as jest.Mock
const mockAggregate = prisma.initiative.aggregate as jest.Mock
const mockCreate = prisma.initiative.create as jest.Mock

const ID = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}
const TEAM = { id: 'team-1', identifier: 'LUM' }

const postReq = (b: unknown) =>
  new NextRequest('http://x/api/initiatives', {
    method: 'POST',
    body: JSON.stringify(b),
  })
const listReq = () => new NextRequest('http://x/api/initiatives')
const detailReq = () => new NextRequest('http://x/api/initiatives/init-1')
const detailCtx = (initiativeId: string) => ({
  params: Promise.resolve({ initiativeId }),
})

beforeEach(() => jest.clearAllMocks())

describe('POST /api/initiatives (direct create)', () => {
  it('POST /api/initiatives creates a team initiative', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(TEAM)
    mockAggregate.mockResolvedValue({ _max: { number: 2 } })
    mockCreate.mockResolvedValue({
      id: 'init-3',
      number: 3,
      name: 'Ship the initiatives surface',
      assumptionNote: 'teams curate directly',
      status: 'ACTIVE',
      createdAt: new Date(0),
    })

    const res = await POST(
      postReq({
        name: 'Ship the initiatives surface',
        assumptionNote: 'teams curate directly',
      })
    )

    expect(res.status).toBe(201)
    const { initiative } = await res.json()
    expect(initiative).toMatchObject({
      identifier: 'LUM-INIT-3',
      name: 'Ship the initiatives surface',
      status: 'ACTIVE',
      taskCount: 0,
    })
    // The row is created with an ACTIVE status, scoped to the
    // caller's team — the number follows the current max (2 → 3).
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamId: 'team-1',
          number: 3,
          status: 'ACTIVE',
          name: 'Ship the initiatives surface',
          assumptionNote: 'teams curate directly',
        }),
      })
    )
  })

  it('400 rejects a blank name via Zod (no create)', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(TEAM)
    const res = await POST(postReq({ name: '   ' }))
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('404 when the workspace has no default team', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(null)
    const res = await POST(postReq({ name: 'valid goal' }))
    expect(res.status).toBe(404)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated', async () => {
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(postReq({ name: 'x' }))
    expect(res.status).toBe(401)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('GET /api/initiatives (list)', () => {
  it('returns the caller team initiatives with LUM-INIT-<n> ids + task counts', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(TEAM)
    mockFindMany.mockResolvedValue([
      {
        id: 'init-2',
        number: 2,
        name: 'Ship the converter',
        status: 'ACTIVE',
        createdAt: new Date(0),
        _count: { tasks: 3 },
      },
      {
        id: 'init-1',
        number: 1,
        name: 'Idea capture',
        status: 'DONE',
        createdAt: new Date(0),
        _count: { tasks: 1 },
      },
    ])

    const res = await GET_LIST(listReq())
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(
      json.initiatives.map((i: { identifier: string }) => i.identifier)
    ).toEqual(['LUM-INIT-2', 'LUM-INIT-1'])
    expect(json.initiatives[0]).toMatchObject({
      name: 'Ship the converter',
      status: 'ACTIVE',
      taskCount: 3,
    })
    // Scoped to the resolved default team — never crosses teams.
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: 'team-1' } })
    )
  })

  it('returns an empty list (no query) when the workspace has no default team', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(null)

    const res = await GET_LIST(listReq())
    expect(res.status).toBe(200)
    expect((await res.json()).initiatives).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated', async () => {
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET_LIST(listReq())
    expect(res.status).toBe(401)
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/initiatives/[initiativeId] (detail w/ lineage)', () => {
  const detailRow = (over: Record<string, unknown> = {}) => ({
    id: 'init-1',
    number: 3,
    teamId: 'team-1',
    name: 'Ship the converter',
    assumptionNote: 'Bet: teams will curate the idea pool',
    status: 'ACTIVE',
    createdAt: new Date(0),
    tasks: [
      { id: 't7', number: 7, title: 'Build the API', status: 'DONE' },
      { id: 't8', number: 8, title: 'Build the page', status: 'TODO' },
    ],
    ...over,
  })

  it('returns goal, bet, status, and attached tasks with correct ids', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(TEAM)
    mockFindUnique.mockResolvedValue(detailRow())

    const res = await GET_DETAIL(detailReq(), detailCtx('init-1'))
    expect(res.status).toBe(200)
    const { initiative } = await res.json()

    expect(initiative).toMatchObject({
      identifier: 'LUM-INIT-3',
      name: 'Ship the converter',
      assumptionNote: 'Bet: teams will curate the idea pool',
      status: 'ACTIVE',
      taskProgress: { total: 2, done: 1 },
    })
    // Attached tasks carry the `<TEAM>-<n>` id.
    expect(
      initiative.tasks.map((t: { identifier: string }) => t.identifier)
    ).toEqual(['LUM-7', 'LUM-8'])
  })

  it('404 (no leak) when the initiative belongs to another team', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(TEAM)
    mockFindUnique.mockResolvedValue(detailRow({ teamId: 'other-team' }))

    const res = await GET_DETAIL(detailReq(), detailCtx('init-1'))
    expect(res.status).toBe(404)
  })

  it('404 when the initiative does not exist', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(TEAM)
    mockFindUnique.mockResolvedValue(null)

    const res = await GET_DETAIL(detailReq(), detailCtx('missing'))
    expect(res.status).toBe(404)
  })

  it('404 when the workspace has no default team', async () => {
    mockIdentity.mockResolvedValue(ID)
    mockTeam.mockResolvedValue(null)

    const res = await GET_DETAIL(detailReq(), detailCtx('init-1'))
    expect(res.status).toBe(404)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('401 when unauthenticated', async () => {
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET_DETAIL(detailReq(), detailCtx('init-1'))
    expect(res.status).toBe(401)
  })
})
