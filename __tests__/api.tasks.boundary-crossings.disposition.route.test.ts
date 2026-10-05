/**
 * @jest-environment node
 *
 * LUM-435 criterion 5 — the safety crux. Dispositioning a boundary-crossing is
 * a human-only write path (mirrors the LUM-422 human-verdict / LUM-426 redline):
 * an agent/CLI bearer identity is refused 403 BEFORE the body is parsed, so an
 * agent can never disposition its own crossing to unblock its own DONE gate.
 */
import { POST } from '@/app/api/tasks/[id]/boundary-crossings/disposition/route'
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
  boundaryCrossingService: { disposition: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockDisposition = boundaryCrossingService.disposition as jest.Mock

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

const params = { params: Promise.resolve({ id: 'LUM-435' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK_IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockDisposition.mockResolvedValue({
    crossingId: 'bc-1',
    disposition: 'CONFIRMED',
  })
})

describe('POST /api/tasks/[id]/boundary-crossings/disposition', () => {
  it('agent-authenticated disposition request is rejected 403 before parse', async () => {
    mockIdentity.mockResolvedValue(BEARER_IDENTITY)
    // The body is a perfectly-shaped disposition — yet the 403 fires on identity
    // ahead of any json()/schema parse, and the service is never reached. (req
    // throws if json() is ever called, proving the body was never parsed, so no
    // disposition is recorded.)
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(mockDisposition).not.toHaveBeenCalled()
  })

  it('agent-authenticated re-disposition request is rejected 403 before parse', async () => {
    mockIdentity.mockResolvedValue(BEARER_IDENTITY)
    // Re-disposition rides the SAME human-only route (no new bypass endpoint,
    // LUM-450): a bearer identity carrying a re-disposition-shaped body — a
    // change to CONFIRMED, or a revert to OPEN — is refused on identity BEFORE
    // json() is ever called, so an agent can never alter the disposition of its
    // own crossing to clear its own gate. The json spy proves no parse happened.
    const jsonSpy = jest.fn(async () => ({
      crossingId: 'bc-1',
      disposition: 'OPEN',
    }))
    const r = { json: jsonSpy, headers: { get: () => null } } as never
    const res = await POST(r, params)
    expect(res.status).toBe(403)
    expect(jsonSpy).not.toHaveBeenCalled()
    expect(mockDisposition).not.toHaveBeenCalled()
  })

  it('records the disposition for a Clerk browser session with caller attribution', async () => {
    const res = await POST(
      req({ crossingId: 'bc-1', disposition: 'CONFIRMED' }),
      params
    )
    expect(res.status).toBe(200)
    expect(mockDisposition).toHaveBeenCalledWith(
      't-1',
      'bc-1',
      'CONFIRMED',
      null,
      {
        actorMemberId: 'member-1',
        actorClerkId: 'clerk-1',
        audit: {
          workspaceId: 'w-1',
          context: expect.objectContaining({ source: 'WEB' }),
        },
      }
    )
  })

  it('passes an optional note through when present', async () => {
    const res = await POST(
      req({
        crossingId: 'bc-1',
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'detector lag',
      }),
      params
    )
    expect(res.status).toBe(200)
    expect(mockDisposition).toHaveBeenCalledWith(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      'detector lag',
      expect.anything()
    )
  })

  it('400 when disposition is missing or invalid (strict schema)', async () => {
    const res = await POST(req({ crossingId: 'bc-1' }), params)
    expect(res.status).toBe(400)
    expect(mockDisposition).not.toHaveBeenCalled()
  })

  it('404 when the task does not resolve in the workspace', async () => {
    mockFindByIdentifier.mockResolvedValue(null)
    const res = await POST(
      req({ crossingId: 'bc-1', disposition: 'CONFIRMED' }),
      params
    )
    expect(res.status).toBe(404)
  })

  it('maps service status errors onto the response', async () => {
    mockDisposition.mockRejectedValue(
      Object.assign(new Error('crossing not on this task'), { status: 404 })
    )
    const res = await POST(
      req({ crossingId: 'bc-1', disposition: 'CONFIRMED' }),
      params
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('crossing not on this task')
  })
})
