/**
 * @jest-environment node
 *
 * LUM-426 criterion 7 — the safety crux. Acknowledging a boundary-crossing is
 * a human-only write path (mirrors the LUM-422 human-verdict redline): an
 * agent/CLI bearer identity is refused 403 BEFORE the body is parsed, so an
 * agent can never acknowledge its own crossing to unblock its own DONE gate.
 */
import { POST } from '@/app/api/tasks/[id]/boundary-crossings/acknowledge/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/boundary-crossing.service', () => ({
  boundaryCrossingService: { acknowledge: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockAck = boundaryCrossingService.acknowledge as jest.Mock

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

const params = { params: Promise.resolve({ id: 'LUM-426' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK_IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockAck.mockResolvedValue({ crossingId: 'bc-1', acknowledged: true })
})

describe('POST /api/tasks/[id]/boundary-crossings/acknowledge', () => {
  it('agent-authenticated acknowledge request is rejected 403 before parse', async () => {
    mockIdentity.mockResolvedValue(BEARER_IDENTITY)
    // The body is a perfectly-shaped ack — yet the 403 fires on identity ahead
    // of any json()/schema parse, and the service is never reached. (req throws
    // if json() is ever called, proving the body was never parsed.)
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(mockAck).not.toHaveBeenCalled()
  })

  it('records the acknowledgement for a Clerk browser session with caller attribution', async () => {
    const res = await POST(req({ crossingId: 'bc-1' }), params)
    expect(res.status).toBe(200)
    expect(mockAck).toHaveBeenCalledWith('t-1', 'bc-1', {
      actorMemberId: 'member-1',
      actorClerkId: 'clerk-1',
    })
  })

  it('400 when crossingId is missing (strict schema)', async () => {
    const res = await POST(req({}), params)
    expect(res.status).toBe(400)
    expect(mockAck).not.toHaveBeenCalled()
  })

  it('404 when the task does not resolve in the workspace', async () => {
    mockFindByIdentifier.mockResolvedValue(null)
    const res = await POST(req({ crossingId: 'bc-1' }), params)
    expect(res.status).toBe(404)
  })

  it('maps service status errors onto the response', async () => {
    mockAck.mockRejectedValue(
      Object.assign(new Error('crossing not on this task'), { status: 404 })
    )
    const res = await POST(req({ crossingId: 'bc-1' }), params)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('crossing not on this task')
  })

  it('masks unexpected errors as 500', async () => {
    mockAck.mockRejectedValue(new Error('db exploded'))
    const res = await POST(req({ crossingId: 'bc-1' }), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Internal Server Error')
  })
})
