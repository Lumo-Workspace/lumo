/**
 * @jest-environment node
 *
 * LUM-542 — the explain route is the deliberate INVERSE of the disposition
 * route. Dispositioning is human-only (bearer refused before parse); explaining
 * is the agent path (clerk refused before parse). Either way the gate-clearing
 * write stays human-only and the agent path can only ever append a note.
 */
import { POST } from '@/app/api/tasks/[id]/boundary-crossings/[crossingId]/explain/route'
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
  boundaryCrossingService: { explain: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockExplain = boundaryCrossingService.explain as jest.Mock

const CLERK_IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER_IDENTITY = { ...CLERK_IDENTITY, source: 'bearer' as const }

function req(body?: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => {
      if (body === undefined) throw new Error('no body')
      return body
    },
    headers: { get: (k: string) => headers[k] ?? null },
  } as never
}

const params = {
  params: Promise.resolve({ id: 'LUM-542', crossingId: 'bc-1' }),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(BEARER_IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockExplain.mockResolvedValue({
    crossingId: 'bc-1',
    explanation: {
      id: 'ex-1',
      note: 'because',
      authorAgent: null,
      authorSessionId: null,
      createdAt: '',
    },
  })
})

describe('POST /api/tasks/[id]/boundary-crossings/[crossingId]/explain', () => {
  it('explain route bearer-only and scope-guarded: a clerk (human) identity is rejected 403 before the body is parsed', async () => {
    mockIdentity.mockResolvedValue(CLERK_IDENTITY)
    // A perfectly-shaped note body — yet the 403 fires on identity ahead of any
    // json()/schema parse, and the service is never reached (json throws if read).
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(mockExplain).not.toHaveBeenCalled()
  })

  it('explain route bearer-only and scope-guarded: a bearer caller appends the note with session/agent attribution from headers', async () => {
    const res = await POST(
      req(
        { note: 'I changed the test because the contract moved' },
        { 'X-Lumo-Session-Id': 's-1', 'X-Lumo-Agent': 'CLAUDE_CODE' }
      ),
      params
    )
    expect(res.status).toBe(201)
    expect(mockExplain).toHaveBeenCalledWith(
      't-1',
      'bc-1',
      'I changed the test because the contract moved',
      {
        authorSessionId: 's-1',
        authorAgent: 'CLAUDE_CODE',
        memberId: 'member-1',
      }
    )
  })

  it('explain route bearer-only and scope-guarded: a service scope rejection (cross-task / unbound) maps onto the response', async () => {
    mockExplain.mockRejectedValue(
      Object.assign(
        new Error(
          'A session can only explain a boundary-crossing on the task it is bound to'
        ),
        { status: 403 }
      )
    )
    const res = await POST(
      req({ note: 'x' }, { 'X-Lumo-Session-Id': 's-other' }),
      params
    )
    expect(res.status).toBe(403)
  })

  it('explain route bearer-only and scope-guarded: rejects 400 on an empty/invalid note (strict schema, no disposition field accepted)', async () => {
    const res = await POST(
      req({ note: '', disposition: 'FALSE_POSITIVE' }),
      params
    )
    expect(res.status).toBe(400)
    expect(mockExplain).not.toHaveBeenCalled()
  })

  it('explain route bearer-only and scope-guarded: 404 when the task does not resolve in the workspace', async () => {
    mockFindByIdentifier.mockResolvedValue(null)
    const res = await POST(req({ note: 'x' }), params)
    expect(res.status).toBe(404)
    expect(mockExplain).not.toHaveBeenCalled()
  })
})
