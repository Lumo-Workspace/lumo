/**
 * @jest-environment node
 */
import { GET, PUT } from '@/app/api/tasks/[id]/criteria/route'
import { requireIdentity } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { taskCriteriaService } from '@/lib/services/task-criteria.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))

// resolveTaskParam now calls prisma.task.findFirst directly (LUM-437: needs
// workStartedAt alongside status). Mock the prisma client so route tests stay
// in-process without a real DB.
jest.mock('@/lib/db/prisma', () => ({
  prisma: { task: { findFirst: jest.fn() } },
}))

jest.mock('@/lib/services/task-criteria.service', () => ({
  taskCriteriaService: {
    listForTask: jest.fn(),
    submitDraft: jest.fn(),
    reviseAsHuman: jest.fn(),
  },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindFirst = prisma.task.findFirst as jest.Mock
const mockList = taskCriteriaService.listForTask as jest.Mock
const mockDraft = taskCriteriaService.submitDraft as jest.Mock
const mockRevise = taskCriteriaService.reviseAsHuman as jest.Mock

const IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'bearer' as const,
}

function req(body?: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => {
      if (body === undefined) throw new Error('no body')
      return body
    },
    headers: { get: (k: string) => headers[k] ?? null },
  } as never
}

const params = { params: Promise.resolve({ id: 'LUM-42' }) }

const draftBody = {
  source: 'AGENT_DRAFT',
  criteria: [
    { statement: 's1', verifierType: 'MACHINE', checkpointer: 'npx jest' },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(IDENTITY)
  mockFindFirst.mockResolvedValue({
    id: 't-1',
    status: 'TODO',
    workStartedAt: null,
  })
})

describe('GET /api/tasks/[id]/criteria', () => {
  it('resolves LUM-N in the workspace and returns the contract', async () => {
    mockList.mockResolvedValue({ criteria: [{ id: 'c-1' }], warning: null })

    const res = await GET(req(), params)

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          number: 42,
          team: expect.objectContaining({
            identifier: 'LUM',
            workspaceId: 'w-1',
          }),
        }),
      })
    )
    expect(mockList).toHaveBeenCalledWith('t-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      criteria: [{ id: 'c-1' }],
      warning: null,
    })
  })

  it('404s when the identifier does not resolve in the workspace', async () => {
    mockFindFirst.mockResolvedValue(null)
    const res = await GET(req(), params)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/tasks/[id]/criteria', () => {
  it('routes AGENT_DRAFT to submitDraft', async () => {
    mockDraft.mockResolvedValue({ criteria: [{ id: 'c-1' }], warning: 'w' })

    const res = await PUT(req(draftBody), params)

    expect(mockDraft).toHaveBeenCalledWith(
      't-1',
      draftBody.criteria,
      {
        actorMemberId: 'member-1',
        sourceSessionId: null,
      },
      'TODO',
      null
    )
    expect(mockRevise).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      criteria: [{ id: 'c-1' }],
      warning: 'w',
    })
  })

  it('routes HUMAN_EDIT to reviseAsHuman with member + session provenance', async () => {
    mockRevise.mockResolvedValue({ criteria: [], warning: null })
    const body = {
      source: 'HUMAN_EDIT',
      criteria: [{ id: 'c-1', statement: 's', verifierType: 'HUMAN' }],
    }

    const res = await PUT(req(body, { 'X-Lumo-Session-Id': 'sess-1' }), params)

    expect(mockRevise).toHaveBeenCalledWith(
      't-1',
      body.criteria,
      {
        actorMemberId: 'member-1',
        sourceSessionId: 'sess-1',
      },
      undefined
    )
    expect(res.status).toBe(200)
  })

  it('threads causeTag through a HUMAN_EDIT revision', async () => {
    mockRevise.mockResolvedValue({ criteria: [], warning: null })
    const body = {
      source: 'HUMAN_EDIT',
      criteria: [{ id: 'c-1', statement: 's', verifierType: 'HUMAN' }],
      causeTag: 'DRAFT_BLIND_SPOT',
    }

    const res = await PUT(req(body), params)

    expect(mockRevise).toHaveBeenCalledWith(
      't-1',
      body.criteria,
      expect.anything(),
      'DRAFT_BLIND_SPOT'
    )
    expect(res.status).toBe(200)
  })

  it('rejects invalid bodies via zod (MACHINE without checkpointer)', async () => {
    const res = await PUT(
      req({
        source: 'AGENT_DRAFT',
        criteria: [{ statement: 's', verifierType: 'MACHINE' }],
      }),
      params
    )
    expect(res.status).toBe(400)
    expect(mockDraft).not.toHaveBeenCalled()
  })

  it('maps service status errors onto the response (agent lock 409)', async () => {
    mockDraft.mockRejectedValue(
      Object.assign(new Error('locked'), { status: 409 })
    )
    const res = await PUT(req(draftBody), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'locked' })
  })

  it('returns 409 for AGENT_DRAFT on a DONE task with existing criteria', async () => {
    // Simulate a DONE task — the route passes task.status to submitDraft which
    // throws the terminal lock error.
    mockFindFirst.mockResolvedValue({
      id: 't-1',
      status: 'DONE',
      workStartedAt: new Date('2026-06-01'),
    })
    mockDraft.mockRejectedValue(
      Object.assign(
        new Error(
          'Acceptance contract locked — the task is DONE. Reopen it (status → in_progress) to change criteria, or record a human decision with `lumo task criteria set --human`.'
        ),
        { status: 409 }
      )
    )
    const res = await PUT(req(draftBody), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('DONE'),
    })
  })

  it('hides internals behind a generic 500 for unknown errors', async () => {
    mockDraft.mockRejectedValue(new Error('db exploded'))
    const res = await PUT(req(draftBody), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
  })
})
