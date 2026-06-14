/**
 * @jest-environment node
 */
import { POST } from '@/app/api/tasks/[id]/human-verdict/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskHumanVerdictService } from '@/lib/services/task-human-verdict.service'
import { machineVerdictInputSchema } from '@/lib/validation/acceptance'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-human-verdict.service', () => ({
  taskHumanVerdictService: { recordHumanVerdict: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockRecord = taskHumanVerdictService.recordHumanVerdict as jest.Mock

const CLERK_IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}

const BEARER_IDENTITY = { ...CLERK_IDENTITY, source: 'bearer' as const }

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
  mockIdentity.mockResolvedValue(CLERK_IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockRecord.mockResolvedValue({
    round: 2,
    verdict: 'PASS',
    taskStatus: 'DONE',
    criterionIds: ['c-1'],
  })
})

describe('POST /api/tasks/[id]/human-verdict', () => {
  it('records a human verdict for a Clerk browser session with the caller attribution', async () => {
    const res = await POST(req({ verdict: 'PASS' }), params)
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith(
      't-1',
      { verdict: 'PASS' },
      { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }
    )
  })

  it('RED LINE: a bearer-token (agent/CLI) identity is refused with 403 and the service is never called', async () => {
    mockIdentity.mockResolvedValue(BEARER_IDENTITY)
    const res = await POST(req({ verdict: 'PASS' }), params)
    expect(res.status).toBe(403)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('RED LINE (LUM-425): a bearer identity is refused with 403 for a per-criterion verdict too — no agent/CLI path to ANY human verdict, body never parsed', async () => {
    mockIdentity.mockResolvedValue(BEARER_IDENTITY)
    // Even a perfectly-shaped per-criterion PASS is rejected before the body is
    // read — the 403 fires on identity, ahead of any schema parse or criterion
    // resolution. PASS / PASS_WITH_FOLLOWUP stay unreachable outside Clerk.
    const res = await POST(
      req({ verdict: 'PASS', criterionIds: ['c-1'] }),
      params
    )
    expect(res.status).toBe(403)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('LUM-425: a Clerk session passes criterionIds through to the service unchanged', async () => {
    const res = await POST(
      req({ verdict: 'FAIL', criterionIds: ['c-1', 'c-2'] }),
      params
    )
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith(
      't-1',
      { verdict: 'FAIL', criterionIds: ['c-1', 'c-2'] },
      { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }
    )
  })

  it('RED LINE: the agent-facing machine schema still has no verifierType and no three-state verdict', () => {
    // The machine write path's schema-layer lock is untouched by this task:
    // smuggling verifierType is rejected, and PASS_WITH_FOLLOWUP stays human
    // vocabulary the machine path cannot express.
    expect(
      machineVerdictInputSchema.safeParse({
        criterionId: 'c-1',
        verdict: 'PASS',
        evidencePointer: 'cmd:npx jest#exit=0',
        verifierType: 'HUMAN',
      }).success
    ).toBe(false)
    expect(
      machineVerdictInputSchema.safeParse({
        criterionId: 'c-1',
        verdict: 'PASS_WITH_FOLLOWUP',
        evidencePointer: 'cmd:npx jest#exit=0',
      }).success
    ).toBe(false)
  })

  it('LUM-422 ①: a bare FAIL (no rejection-reason enum) is now accepted', async () => {
    mockRecord.mockResolvedValue({
      round: 1,
      verdict: 'FAIL',
      taskStatus: 'IN_PROGRESS',
      criterionIds: ['c-1'],
      commentId: null,
    })
    const res = await POST(req({ verdict: 'FAIL' }), params)
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith(
      't-1',
      { verdict: 'FAIL' },
      expect.anything()
    )
  })

  it('400 when a removed rejectionReasonEnum is smuggled in (strict schema)', async () => {
    const res = await POST(
      req({ verdict: 'FAIL', rejectionReasonEnum: 'OTHER' }),
      params
    )
    expect(res.status).toBe(400)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('404 when the task does not resolve in the workspace', async () => {
    mockFindByIdentifier.mockResolvedValue(null)
    const res = await POST(req({ verdict: 'PASS' }), params)
    expect(res.status).toBe(404)
  })

  it('maps service status errors onto the response', async () => {
    mockRecord.mockRejectedValue(
      Object.assign(new Error('no contract'), { status: 400 })
    )
    const res = await POST(req({ verdict: 'PASS' }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no contract')
  })

  it('masks unexpected errors as 500', async () => {
    mockRecord.mockRejectedValue(new Error('db exploded'))
    const res = await POST(req({ verdict: 'PASS' }), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Internal Server Error')
  })

  it('returns the identity response when auth fails', async () => {
    const { NextResponse } = await import('next/server')
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(req({ verdict: 'PASS' }), params)
    expect(res.status).toBe(401)
    expect(mockRecord).not.toHaveBeenCalled()
  })
})
