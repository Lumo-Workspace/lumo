/**
 * @jest-environment node
 *
 * LUM-769 — the CLI disposition route is the bearer-only counterpart of the
 * web disposition route: a Clerk (human/browser) identity is refused 403
 * BEFORE the body is parsed, a bearer caller reaches the service with
 * `channel: 'CLI'`, and the body is strict — the OPEN revert sentinel and the
 * LUM-751 suppression opt-in are unrepresentable here (they stay web-only).
 */
import { POST } from '@/app/api/tasks/[id]/boundary-crossings/[crossingId]/disposition/route'
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
  const json = jest.fn(async () => {
    if (body === undefined) throw new Error('no body')
    return body
  })
  return {
    request: { json, headers: { get: () => null } } as never,
    json,
  }
}

const params = {
  params: Promise.resolve({ id: 'LUM-769', crossingId: 'bc-1' }),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(BEARER_IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockDisposition.mockResolvedValue({
    crossingId: 'bc-1',
    disposition: 'FALSE_POSITIVE',
  })
})

describe('POST /api/tasks/[id]/boundary-crossings/[crossingId]/disposition (CLI, LUM-769)', () => {
  it('a clerk (human/browser) identity is rejected 403 before the body is parsed', async () => {
    mockIdentity.mockResolvedValue(CLERK_IDENTITY)
    const { request, json } = req({ disposition: 'FALSE_POSITIVE' })
    const res = await POST(request, params)
    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(mockDisposition).not.toHaveBeenCalled()
  })

  it('a bearer caller records the ruling with channel CLI and the optional note', async () => {
    const { request } = req({
      disposition: 'FALSE_POSITIVE',
      dispositionNote: 'covered by run-outbound tests',
    })
    const res = await POST(request, params)
    expect(res.status).toBe(200)
    expect(mockDisposition).toHaveBeenCalledWith(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      'covered by run-outbound tests',
      { actorMemberId: 'member-1', actorClerkId: 'clerk-1', channel: 'CLI' }
    )
    // The LUM-751 suppression options are never forwarded from this route.
    expect(mockDisposition.mock.calls[0]).toHaveLength(5)
    await expect(res.json()).resolves.toEqual({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      channel: 'CLI',
    })
  })

  it('the note is optional: CONFIRMED with no note reaches the service with a null note', async () => {
    const { request } = req({ disposition: 'CONFIRMED' })
    const res = await POST(request, params)
    expect(res.status).toBe(200)
    expect(mockDisposition.mock.calls[0][2]).toBe('CONFIRMED')
    expect(mockDisposition.mock.calls[0][3]).toBeNull()
  })

  it.each([
    ['the OPEN revert sentinel', { disposition: 'OPEN' }],
    [
      'the suppression opt-in',
      { disposition: 'FALSE_POSITIVE', suppressSimilarInProject: true },
    ],
    [
      'a smuggled crossingId',
      { disposition: 'FALSE_POSITIVE', crossingId: 'bc-other' },
    ],
    ['a missing disposition', { dispositionNote: 'x' }],
    ['a non-JSON body', undefined],
  ])(
    'the body is strict: %s is a 400 and nothing is written',
    async (_label, body) => {
      const { request } = req(body)
      const res = await POST(request, params)
      expect(res.status).toBe(400)
      expect(mockDisposition).not.toHaveBeenCalled()
    }
  )

  it('an unknown task is 404 and a crossing off the task surfaces the service 404', async () => {
    mockFindByIdentifier.mockResolvedValueOnce(null)
    const first = await POST(req({ disposition: 'CONFIRMED' }).request, params)
    expect(first.status).toBe(404)
    expect(mockDisposition).not.toHaveBeenCalled()

    mockDisposition.mockRejectedValueOnce(
      Object.assign(new Error('Boundary-crossing not found on this task'), {
        status: 404,
      })
    )
    const second = await POST(req({ disposition: 'CONFIRMED' }).request, params)
    expect(second.status).toBe(404)
    await expect(second.json()).resolves.toEqual({
      error: 'Boundary-crossing not found on this task',
    })
  })
})
