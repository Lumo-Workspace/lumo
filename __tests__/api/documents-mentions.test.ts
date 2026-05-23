/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/documents/[id]/mentions/route'
import { DELETE } from '@/app/api/documents/[id]/mentions/[taskId]/route'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: jest.fn(),
  zodError: jest.fn(),
}))
jest.mock('@/lib/services', () => ({
  documentService: {
    addExplicitMention: jest.fn(),
    removeExplicitMention: jest.fn(),
  },
}))

const { requireAuth } = jest.requireMock('@/lib/auth') as {
  requireAuth: jest.Mock
}
const { requireUserWorkspace, zodError } = jest.requireMock(
  '@/lib/api/helpers'
) as {
  requireUserWorkspace: jest.Mock
  zodError: jest.Mock
}
const { documentService } = jest.requireMock('@/lib/services') as {
  documentService: {
    addExplicitMention: jest.Mock
    removeExplicitMention: jest.Mock
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  requireAuth.mockResolvedValue({ userId: 'user_clerk_1' })
  requireUserWorkspace.mockResolvedValue({
    workspaceId: 'ws1',
    member: { id: 'member1' },
  })
  zodError.mockImplementation(
    () => new Response(JSON.stringify({ error: 'zod' }), { status: 400 })
  )
})

function mkPostReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc1/mentions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents/[id]/mentions', () => {
  it('binds a doc to a task and returns 201', async () => {
    documentService.addExplicitMention.mockResolvedValueOnce({
      taskId: 'task_cuid_1',
      taskIdentifier: 'LUM-42',
      source: 'EXPLICIT',
      alreadyBound: false,
      upgradedFromContent: false,
    })
    const res = await POST(mkPostReq({ taskIdentifier: 'LUM-42' }), {
      params: Promise.resolve({ id: 'doc1' }),
    })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.mention.taskIdentifier).toBe('LUM-42')
    expect(documentService.addExplicitMention).toHaveBeenCalledWith(
      'doc1',
      'LUM-42',
      'ws1',
      'member1'
    )
  })

  it('rejects empty taskIdentifier with 400', async () => {
    const res = await POST(mkPostReq({ taskIdentifier: '' }), {
      params: Promise.resolve({ id: 'doc1' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing taskIdentifier with 400', async () => {
    const res = await POST(mkPostReq({}), {
      params: Promise.resolve({ id: 'doc1' }),
    })
    expect(res.status).toBe(400)
  })

  it('propagates service 404 when task not found', async () => {
    documentService.addExplicitMention.mockRejectedValueOnce(
      Object.assign(new Error('Task not found: LUM-999'), { status: 404 })
    )
    const res = await POST(mkPostReq({ taskIdentifier: 'LUM-999' }), {
      params: Promise.resolve({ id: 'doc1' }),
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/Task not found/)
  })
})

describe('DELETE /api/documents/[id]/mentions/[taskId]', () => {
  it('removes an EXPLICIT mention and returns 200', async () => {
    documentService.removeExplicitMention.mockResolvedValueOnce({
      removed: 1,
      refused: false,
      taskIdentifier: 'LUM-42',
    })
    const req = new NextRequest(
      'http://localhost/api/documents/doc1/mentions/LUM-42',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ id: 'doc1', taskId: 'LUM-42' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.removed).toBe(1)
    expect(documentService.removeExplicitMention).toHaveBeenCalledWith(
      'doc1',
      'LUM-42',
      'ws1',
      'member1'
    )
  })

  it('returns 409 when refused (CONTENT-only mention)', async () => {
    documentService.removeExplicitMention.mockResolvedValueOnce({
      removed: 0,
      refused: true,
      reason: 'Cannot unbind a content-derived mention; remove the @LUM-N from the doc body instead.',
      taskIdentifier: 'LUM-42',
    })
    const req = new NextRequest(
      'http://localhost/api/documents/doc1/mentions/LUM-42',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ id: 'doc1', taskId: 'LUM-42' }),
    })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/content-derived/)
    expect(json.removed).toBe(0)
  })

  it('returns 200 with removed=0 for idempotent delete', async () => {
    documentService.removeExplicitMention.mockResolvedValueOnce({
      removed: 0,
      refused: false,
      taskIdentifier: 'LUM-42',
    })
    const req = new NextRequest(
      'http://localhost/api/documents/doc1/mentions/LUM-42',
      { method: 'DELETE' }
    )
    const res = await DELETE(req, {
      params: Promise.resolve({ id: 'doc1', taskId: 'LUM-42' }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.removed).toBe(0)
  })
})
