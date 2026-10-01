/**
 * @jest-environment node
 */
jest.mock('@/lib/auth/identity', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: { getContextForIdentifier: jest.fn() },
}))
// LUM-686: the route composes next-step suggestions from acceptance state.
// Mocked here — this suite covers the route's own contract, not those reads.
jest.mock('@/lib/services/next-steps.service', () => ({
  nextStepsService: { forExistingTask: jest.fn().mockResolvedValue([]) },
}))
// LUM-923: the pending-deletion notice is covered in workspace-deletion/.
jest.mock('@/lib/services/workspace-deletion.service', () => ({
  workspaceDeletionService: {
    buildPendingNoticeSection: jest.fn().mockResolvedValue(''),
  },
}))

import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { taskContextService } from '@/lib/services/task-context.service'
import { GET } from '@/app/api/tasks/context/[identifier]/route'

const mockIdentity = requireIdentity as jest.Mock
const mockCtx = taskContextService.getContextForIdentifier as jest.Mock

const identity = {
  clerkId: 'clerk_1',
  memberId: 'member_1',
  workspaceId: 'ws_1',
  workspaceSlug: 'ws',
  workspaceName: 'WS',
  source: 'bearer' as const,
}

function req(identifier: string, headers: Record<string, string> = {}) {
  return new Request(`http://x/api/tasks/context/${identifier}`, { headers })
}
function ctx(identifier: string) {
  return { params: Promise.resolve({ identifier }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(identity)
})

describe('GET /api/tasks/context/[identifier]', () => {
  it('returns 401 when bearer is missing', async () => {
    mockIdentity.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET(req('LUM-30'), ctx('LUM-30'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the task is not in the workspace', async () => {
    mockCtx.mockResolvedValueOnce(null)
    const res = await GET(
      req('LUM-30', { Authorization: 'Bearer good' }),
      ctx('LUM-30')
    )
    expect(res.status).toBe(404)
    expect(mockCtx).toHaveBeenCalledWith('ws_1', 'member_1', 'LUM-30')
  })

  it('returns the assembled context on hit', async () => {
    const context = { task: { identifier: 'LUM-30' }, sessions: [] }
    mockCtx.mockResolvedValueOnce(context)
    const res = await GET(
      req('LUM-30', { Authorization: 'Bearer good' }),
      ctx('LUM-30')
    )
    expect(res.status).toBe(200)
    // LUM-686: the route now appends the next-step block alongside the
    // assembled context; the context payload itself passes through unchanged.
    expect(await res.json()).toEqual({
      ...context,
      nextSteps: [],
      workspaceNoticeSection: '',
    })
  })
})
