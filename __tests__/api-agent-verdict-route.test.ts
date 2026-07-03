/**
 * @jest-environment node
 */
import { POST } from '@/app/api/tasks/[id]/agent-verdict/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskAgentVerdictService } from '@/lib/services/task-agent-verdict.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-agent-verdict.service', () => ({
  taskAgentVerdictService: { recordAgentVerdict: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockRecord = taskAgentVerdictService.recordAgentVerdict as jest.Mock

const BEARER_IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'bearer' as const,
}

function req(body?: unknown) {
  return {
    json: async () => {
      if (body === undefined) throw new Error('no body')
      return body
    },
    headers: { get: () => null },
  } as never
}

const params = { params: Promise.resolve({ id: 'LUM-42' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(BEARER_IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockRecord.mockResolvedValue({
    round: 2,
    verdict: 'FAIL',
    taskStatus: 'IN_PROGRESS',
    criterionIds: ['c-1'],
    commentId: null,
  })
})

describe('POST /api/tasks/[id]/agent-verdict', () => {
  it('records an AGENT send-back for a bearer (CLI) identity with caller attribution', async () => {
    const res = await POST(
      req({ rejectionReasonEnum: 'CRITERION_UNMET' }),
      params
    )
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith(
      't-1',
      { rejectionReasonEnum: 'CRITERION_UNMET' },
      {
        actorMemberId: 'member-1',
        actorClerkId: 'clerk-1',
        // LUM-640: session provenance rides along (null when no header).
        sourceSessionId: null,
      }
    )
  })

  it('RED LINE: a body smuggling verdict=PASS is rejected 400 — the agent path has no passing verdict', async () => {
    const res = await POST(
      req({ rejectionReasonEnum: 'OTHER', verdict: 'PASS' }),
      params
    )
    expect(res.status).toBe(400)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('400 when rejectionReasonEnum is missing (the agent pays the structured tax)', async () => {
    const res = await POST(req({ note: 'no enum' }), params)
    expect(res.status).toBe(400)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('forwards note + criterionIds through to the service', async () => {
    await POST(
      req({
        rejectionReasonEnum: 'SCOPE_MISMATCH',
        note: 'redo the retry path',
        criterionIds: ['c-1', 'c-2'],
      }),
      params
    )
    expect(mockRecord).toHaveBeenCalledWith(
      't-1',
      {
        rejectionReasonEnum: 'SCOPE_MISMATCH',
        note: 'redo the retry path',
        criterionIds: ['c-1', 'c-2'],
      },
      expect.anything()
    )
  })

  it('404 when the task does not resolve in the workspace', async () => {
    mockFindByIdentifier.mockResolvedValue(null)
    const res = await POST(req({ rejectionReasonEnum: 'OTHER' }), params)
    expect(res.status).toBe(404)
  })

  it('maps service status errors onto the response', async () => {
    mockRecord.mockRejectedValue(
      Object.assign(new Error('no contract'), { status: 400 })
    )
    const res = await POST(req({ rejectionReasonEnum: 'OTHER' }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no contract')
  })

  it('masks unexpected errors as 500', async () => {
    mockRecord.mockRejectedValue(new Error('db exploded'))
    const res = await POST(req({ rejectionReasonEnum: 'OTHER' }), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Internal Server Error')
  })

  it('returns the identity response when auth fails', async () => {
    const { NextResponse } = await import('next/server')
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(req({ rejectionReasonEnum: 'OTHER' }), params)
    expect(res.status).toBe(401)
    expect(mockRecord).not.toHaveBeenCalled()
  })
})
