/**
 * @jest-environment node
 */
import { POST } from '@/app/api/tasks/[id]/verify/route'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { enforceSessionBinding } from '@/lib/services/session-binding-guard'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn(),
}))
jest.mock('@/lib/services/task-verification.service', () => ({
  taskVerificationService: { recordMachineRound: jest.fn() },
}))
jest.mock('@/lib/services/session-binding-guard', () => ({
  enforceSessionBinding: jest.fn(),
}))

const identity = requireIdentity as jest.Mock
const resolve = resolveTaskParam as jest.Mock
const record = taskVerificationService.recordMachineRound as jest.Mock
const enforce = enforceSessionBinding as jest.Mock

const VALID_RESULT = {
  criterionId: 'c1',
  verdict: 'FAIL',
  rejectionReason: 'test failure',
}

function req(sessionId?: string) {
  return new Request('http://x/api/tasks/LUM-1/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { 'X-Lumo-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ results: [VALID_RESULT] }),
  }) as any
}
const params = { params: Promise.resolve({ id: 'LUM-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  identity.mockResolvedValue({
    memberId: 'm1',
    clerkId: 'c1',
    workspaceId: 'w1',
    source: 'bearer',
  })
  resolve.mockResolvedValue({
    id: 't1',
    status: 'IN_PROGRESS',
    workStartedAt: null,
  })
  record.mockResolvedValue({
    round: 1,
    allPassed: true,
    results: [],
    nextActions: [],
  })
})

describe('verify route + session-binding guard', () => {
  it('runs the round and echoes the advisory when bound correctly', async () => {
    enforce.mockResolvedValue({ advisory: null })
    const res = await POST(req('sess'), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bindingAdvisory).toBeNull()
    expect(record).toHaveBeenCalled()
    expect(enforce).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'bearer',
        sessionId: 'sess',
        memberId: 'm1',
        targetTaskId: 't1',
        action: 'machine verification',
      })
    )
  })
  it('returns 409 and does NOT record the round on a mismatch', async () => {
    enforce.mockRejectedValue(
      Object.assign(new Error('bound to LUM-487'), { status: 409 })
    )
    const res = await POST(req('sess'), params)
    expect(res.status).toBe(409)
    expect(record).not.toHaveBeenCalled()
  })
  it('surfaces the unbound advisory while still recording the round', async () => {
    enforce.mockResolvedValue({ advisory: 'unbound' })
    const res = await POST(req('sess'), params)
    expect(res.status).toBe(200)
    expect((await res.json()).bindingAdvisory).toBe('unbound')
    expect(record).toHaveBeenCalled()
  })
})
