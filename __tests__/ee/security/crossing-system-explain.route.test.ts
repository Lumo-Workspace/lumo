/**
 * @jest-environment node
 *
 * LUM-590 — the system-explain route is human/Clerk-only (mirrors the
 * disposition route). Bearer/agent identities are refused 403 before any work.
 */
import { POST } from '@/app/api/tasks/[id]/boundary-crossings/[crossingId]/system-explain/route'
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
  boundaryCrossingService: { explainCrossing: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockExplainCrossing = boundaryCrossingService.explainCrossing as jest.Mock

const CLERK_IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER_IDENTITY = { ...CLERK_IDENTITY, source: 'bearer' as const }

function req() {
  return {
    json: async () => ({}),
    headers: { get: () => null },
  } as never
}

const params = {
  params: Promise.resolve({ id: 'LUM-590', crossingId: 'bc-1' }),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK_IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockExplainCrossing.mockResolvedValue({ explanation: 'Generated text.' })
})

describe('POST /api/tasks/[id]/boundary-crossings/[crossingId]/system-explain', () => {
  it('bearer/agent identity is rejected 403 before any work (human-only auth)', async () => {
    mockIdentity.mockResolvedValue(BEARER_IDENTITY)

    const res = await POST(req(), params)

    expect(res.status).toBe(403)
    expect(mockExplainCrossing).not.toHaveBeenCalled()
  })

  it('clerk identity is accepted and returns the explanation', async () => {
    const res = await POST(req(), params)
    const body = (await res.json()) as { explanation: string }

    expect(res.status).toBe(200)
    expect(body.explanation).toBe('Generated text.')
    expect(mockExplainCrossing).toHaveBeenCalledWith('t-1', 'bc-1')
  })

  it('returns 404 when task is not found', async () => {
    mockFindByIdentifier.mockResolvedValue(null)

    const res = await POST(req(), params)
    expect(res.status).toBe(404)
    expect(mockExplainCrossing).not.toHaveBeenCalled()
  })

  it('maps service 404 to 404', async () => {
    mockExplainCrossing.mockRejectedValue(
      Object.assign(new Error('not found'), { status: 404 })
    )
    const res = await POST(req(), params)
    expect(res.status).toBe(404)
  })

  it('maps service 502 (LLM failure) to 502', async () => {
    mockExplainCrossing.mockRejectedValue(
      Object.assign(new Error('LLM call failed'), { status: 502 })
    )
    const res = await POST(req(), params)
    expect(res.status).toBe(502)
  })
})
