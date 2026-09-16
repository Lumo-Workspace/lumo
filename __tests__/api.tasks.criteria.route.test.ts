/**
 * @jest-environment node
 */
import { GET, PUT } from '@/app/api/tasks/[id]/criteria/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskCriteriaService } from '@/lib/services/task-criteria.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-criteria.service', () => ({
  taskCriteriaService: {
    listForTask: jest.fn(),
    submitDraft: jest.fn(),
    reviseAsHuman: jest.fn(),
  },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
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
    {
      statement: 's1',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest',
      referentKind: 'EXTERNAL_FACT',
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(IDENTITY)
  // status: 'TODO' — any non-IN_REVIEW status suffices here; these tests
  // don't exercise the REVIEW_ADDED new-row stamp branch.
  mockFindByIdentifier.mockResolvedValue({
    id: 't-1',
    status: 'TODO',
    workStartedAt: null,
  })
})

describe('GET /api/tasks/[id]/criteria', () => {
  it('resolves LUM-N in the workspace and returns the contract', async () => {
    mockList.mockResolvedValue({ criteria: [{ id: 'c-1' }], warning: null })

    const res = await GET(req(), params)

    expect(mockFindByIdentifier).toHaveBeenCalledWith('w-1', 'LUM', 42)
    expect(mockList).toHaveBeenCalledWith('t-1')
    expect(res.status).toBe(200)
    // N-5 (whole-branch review, second pass): the route now also carries the
    // task's status (already resolved by `resolveTaskParam`, no extra query)
    // so `lumo task criteria confirm` can pre-check DONE before printing its
    // exit-4 envelope, instead of discovering the 409 on the second call.
    expect(await res.json()).toEqual({
      criteria: [{ id: 'c-1' }],
      warning: null,
      status: 'TODO',
    })
  })

  it('404s when the identifier does not resolve in the workspace', async () => {
    mockFindByIdentifier.mockResolvedValue(null)
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
        origin: 'cli',
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
      criteria: [
        {
          id: 'c-1',
          statement: 's',
          verifierType: 'HUMAN',
          referentKind: 'EXTERNAL_FACT',
        },
      ],
    }

    const res = await PUT(req(body, { 'X-Lumo-Session-Id': 'sess-1' }), params)

    expect(mockRevise).toHaveBeenCalledWith(
      't-1',
      body.criteria,
      {
        actorMemberId: 'member-1',
        sourceSessionId: 'sess-1',
        origin: 'cli',
      },
      'TODO',
      undefined
    )
    expect(res.status).toBe(200)
  })

  it('threads causeTag through a HUMAN_EDIT revision', async () => {
    mockRevise.mockResolvedValue({ criteria: [], warning: null })
    const body = {
      source: 'HUMAN_EDIT',
      criteria: [
        {
          id: 'c-1',
          statement: 's',
          verifierType: 'HUMAN',
          referentKind: 'EXTERNAL_FACT',
        },
      ],
      causeTag: 'DRAFT_BLIND_SPOT',
    }

    const res = await PUT(req(body), params)

    expect(mockRevise).toHaveBeenCalledWith(
      't-1',
      body.criteria,
      expect.anything(),
      'TODO',
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
    mockFindByIdentifier.mockResolvedValue({
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
