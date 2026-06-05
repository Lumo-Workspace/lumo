/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/documents/[id]/revisions/route'
import { POST as RESTORE } from '@/app/api/documents/[id]/revisions/[revId]/restore/route'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/helpers', () => ({ zodError: jest.fn() }))
jest.mock('@/lib/services', () => ({
  documentRevisionService: {
    listRevisions: jest.fn(),
    createManualSnapshot: jest.fn(),
    restoreRevision: jest.fn(),
  },
}))

const { requireIdentity } = jest.requireMock('@/lib/auth') as { requireIdentity: jest.Mock }
const { zodError } = jest.requireMock('@/lib/api/helpers') as { zodError: jest.Mock }
const { documentRevisionService } = jest.requireMock('@/lib/services') as {
  documentRevisionService: { listRevisions: jest.Mock; createManualSnapshot: jest.Mock; restoreRevision: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  requireIdentity.mockResolvedValue({
    clerkId: 'u1', memberId: 'm1', workspaceId: 'ws1',
    workspaceSlug: 'ws', workspaceName: 'WS', source: 'clerk',
  })
  zodError.mockImplementation(() => new Response(JSON.stringify({ error: 'zod' }), { status: 400 }))
})

const ctx = (id: string, revId?: string) => ({
  params: Promise.resolve(revId ? { id, revId } : { id }),
})

describe('GET /revisions', () => {
  it('returns the version list', async () => {
    documentRevisionService.listRevisions.mockResolvedValue([{ id: 'r1' }])
    const res = await GET(new NextRequest('http://localhost/api/documents/d1/revisions'), ctx('d1') as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revisions: [{ id: 'r1' }] })
    expect(documentRevisionService.listRevisions).toHaveBeenCalledWith('d1', 'm1', 'ws1')
  })
})

describe('POST /revisions (manual)', () => {
  it('creates a manual snapshot', async () => {
    documentRevisionService.createManualSnapshot.mockResolvedValue({ id: 'r1', label: 'v1' })
    const req = new NextRequest('http://localhost/api/documents/d1/revisions', {
      method: 'POST', body: JSON.stringify({ label: 'v1' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, ctx('d1') as any)
    expect(res.status).toBe(201)
    expect(documentRevisionService.createManualSnapshot).toHaveBeenCalledWith('d1', 'm1', 'ws1', 'v1')
  })

  it('400s on an empty label', async () => {
    const req = new NextRequest('http://localhost/api/documents/d1/revisions', {
      method: 'POST', body: JSON.stringify({ label: '' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, ctx('d1') as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /revisions/:revId/restore', () => {
  it('restores and returns the document', async () => {
    documentRevisionService.restoreRevision.mockResolvedValue({ id: 'd1' })
    const res = await RESTORE(
      new NextRequest('http://localhost/api/documents/d1/revisions/r1/restore', { method: 'POST' }),
      ctx('d1', 'r1') as any
    )
    expect(res.status).toBe(200)
    expect(documentRevisionService.restoreRevision).toHaveBeenCalledWith('d1', 'r1', 'm1', 'ws1')
  })

  it('propagates a 403 from the service', async () => {
    documentRevisionService.restoreRevision.mockRejectedValue(Object.assign(new Error('Permission denied'), { status: 403 }))
    const res = await RESTORE(
      new NextRequest('http://localhost/api/documents/d1/revisions/r1/restore', { method: 'POST' }),
      ctx('d1', 'r1') as any
    )
    expect(res.status).toBe(403)
  })
})
