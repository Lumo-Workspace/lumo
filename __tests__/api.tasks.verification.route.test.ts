/**
 * @jest-environment node
 */
import { POST } from '@/app/api/tasks/[id]/verify/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskVerificationService } from '@/lib/services/task-verification.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-verification.service', () => ({
  taskVerificationService: { recordMachineRound: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockRecord = taskVerificationService.recordMachineRound as jest.Mock

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

const goodBody = {
  results: [
    {
      criterionId: 'c-1',
      verdict: 'PASS',
      evidencePointer: 'cmd:npx jest#exit=0',
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockRecord.mockResolvedValue({
    round: 1,
    maxRounds: 3,
    allPassed: true,
    escalated: false,
    taskStatus: 'IN_REVIEW',
    results: [],
    nextActions: [],
  })
})

describe('POST /api/tasks/[id]/verify', () => {
  it('records a machine round with the caller attribution and session 出处', async () => {
    const res = await POST(
      req(goodBody, { 'X-Lumo-Session-Id': 'sess-1' }),
      params
    )
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith('t-1', 'w-1', goodBody.results, {
      actorMemberId: 'member-1',
      actorClerkId: 'clerk-1',
      sourceSessionId: 'sess-1',
    })
  })

  it('RED LINE: a body smuggling verifierType is rejected at the schema (400), service never called', async () => {
    const res = await POST(
      req({
        results: [
          {
            criterionId: 'c-1',
            verdict: 'PASS',
            evidencePointer: 'cmd:npx jest#exit=0',
            verifierType: 'HUMAN',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(400)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('rejects free-text evidence (format gate) with 400', async () => {
    const res = await POST(
      req({
        results: [
          {
            criterionId: 'c-1',
            verdict: 'PASS',
            evidencePointer: 'trust me, it works',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(400)
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('404 when the task does not resolve in the workspace', async () => {
    mockFindByIdentifier.mockResolvedValue(null)
    const res = await POST(req(goodBody), params)
    expect(res.status).toBe(404)
  })

  it('maps service status errors (409 cap) onto the response', async () => {
    mockRecord.mockRejectedValue(
      Object.assign(new Error('capped'), { status: 409 })
    )
    const res = await POST(req(goodBody), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('capped')
  })

  it('masks unexpected errors as 500', async () => {
    mockRecord.mockRejectedValue(new Error('db exploded'))
    const res = await POST(req(goodBody), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Internal Server Error')
  })

  it('returns the identity response when auth fails', async () => {
    const { NextResponse } = await import('next/server')
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(req(goodBody), params)
    expect(res.status).toBe(401)
    expect(mockRecord).not.toHaveBeenCalled()
  })
})
