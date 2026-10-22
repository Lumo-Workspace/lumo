/**
 * @jest-environment node
 */

jest.mock('@/lib/auth/bearer', () => ({
  verifyBearer: jest.fn(),
}))

jest.mock('@/lib/services/task-cli.service', () => ({
  taskCliService: {
    createFromCli: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findMemberIdForHook: jest.fn(),
  },
}))

import { POST } from '@/app/api/tasks/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { taskCliService } from '@/lib/services/task-cli.service'
import { miscRepository } from '@/lib/repositories/misc.repository'

const mockVerify = verifyBearer as jest.Mock
const mockCreate = taskCliService.createFromCli as jest.Mock
const mockFindMember = miscRepository.findMemberIdForHook as jest.Mock

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://x/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_test',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

const IDENTITY = {
  user: { id: 'clerk-1' },
  workspace: { id: 'ws-1', slug: 'lumo', name: 'Lumo' },
  apiKey: { id: 'k-1', name: 'CLI', prefix: 'lum_test' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindMember.mockResolvedValue('member-1')
})

describe('POST /api/tasks', () => {
  it('returns 401 when bearer is missing or invalid', async () => {
    mockVerify.mockResolvedValue(null)
    const res = await POST(makeRequest({ title: 'Hi' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when body fails zod validation', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    const res = await POST(makeRequest({ title: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 201 with task identifier and URL on success', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockResolvedValue({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Hi',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
    })

    const res = await POST(makeRequest({ title: 'Hi' }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.task).toEqual({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Hi',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
    })
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      memberId: 'member-1',
      sessionId: null,
      input: expect.objectContaining({ title: 'Hi', priority: 'NONE' }),
    })
  })

  it('forwards the resolved memberId and X-Lumo-Session-Id to the service', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockResolvedValue({
      id: 't-1',
      identifier: 'LUM-9',
      title: 'x',
      url: 'u',
    })

    const res = await POST(
      makeRequest({ title: 'New task' }, { 'X-Lumo-Session-Id': 'sess-123' })
    )

    expect(res.status).toBe(201)
    const arg = mockCreate.mock.calls[0]![0]
    expect(arg.sessionId).toBe('sess-123')
    expect(arg.memberId).toBe('member-1')
  })

  it('passes sessionId: null when no session header is present (unbound — still creates)', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockResolvedValue({
      id: 't-1',
      identifier: 'LUM-9',
      title: 'x',
      url: 'u',
    })

    const res = await POST(makeRequest({ title: 'New task' }))

    expect(res.status).toBe(201)
    const arg = mockCreate.mock.calls[0]![0]
    expect(arg.sessionId).toBeNull()
  })

  it('maps service errors with status to that status', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockRejectedValue(
      Object.assign(new Error('no project matches "foo"'), { status: 400 })
    )

    const res = await POST(makeRequest({ title: 'Hi', projectRef: 'foo' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('no project matches "foo"')
  })

  it('maps thrown errors without status to 500 and hides the message', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockRejectedValue(new Error('db blew up'))

    const res = await POST(makeRequest({ title: 'Hi' }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Internal Server Error')
  })

  it('falls back to 500 when error has non-numeric status', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockRejectedValue(
      Object.assign(new Error('weird'), { status: undefined })
    )

    const res = await POST(makeRequest({ title: 'Hi' }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Internal Server Error')
  })

  it('reports that a background duplicate check was scheduled (LUM-1286)', async () => {
    mockVerify.mockResolvedValue(IDENTITY)
    mockCreate.mockResolvedValue({
      id: 't',
      identifier: 'LUM-1',
      title: 'x',
      url: 'u',
      duplicateCheck: 'scheduled',
    })

    const res = await POST(makeRequest({ title: 'x' }))

    expect(res.status).toBe(201)
    expect((await res.json()).duplicateCheck).toBe('scheduled')
  })
})
