/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '@/app/api/tags/resolve/route'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: jest.fn(),
  zodError: jest.fn(),
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findOrCreateMany: jest.fn(),
  },
}))

const { requireAuth } = jest.requireMock('@/lib/auth') as {
  requireAuth: jest.Mock
}
const { requireUserWorkspace } = jest.requireMock('@/lib/api/helpers') as {
  requireUserWorkspace: jest.Mock
  zodError: jest.Mock
}
const { tagRepository } = jest.requireMock(
  '@/lib/repositories/tag.repository'
) as {
  tagRepository: {
    findOrCreateMany: jest.Mock
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  requireAuth.mockResolvedValue({ userId: 'user_clerk_1' })
  requireUserWorkspace.mockResolvedValue({ workspaceId: 'ws1' })
  tagRepository.findOrCreateMany.mockResolvedValue([])
})

function mkReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/tags/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/tags/resolve', () => {
  it('creates missing tags and returns the id for each input name', async () => {
    tagRepository.findOrCreateMany.mockResolvedValueOnce([
      { id: 'tag1', name: 'bug', color: null },
      { id: 'tag2', name: 'feat', color: '#abc' },
    ])

    const res = await POST(mkReq({ names: ['bug', 'feat'] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tags).toHaveLength(2)
    expect(json.tags[0].id).toBe('tag1')
    expect(json.tags[1].id).toBe('tag2')
    expect(tagRepository.findOrCreateMany).toHaveBeenCalledWith('ws1', [
      'bug',
      'feat',
    ])
  })

  it('returns existing tag for an already-present name', async () => {
    tagRepository.findOrCreateMany.mockResolvedValueOnce([
      { id: 'existing1', name: 'backend', color: null },
    ])

    const res = await POST(mkReq({ names: ['backend'] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tags).toHaveLength(1)
    expect(json.tags[0].id).toBe('existing1')
    expect(json.tags[0].name).toBe('backend')
  })

  it('rejects empty-after-trim name with 400', async () => {
    const res = await POST(mkReq({ names: ['valid', '   ', 'also-valid'] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
    expect(tagRepository.findOrCreateMany).not.toHaveBeenCalled()
  })

  it('rejects >20 names with 400', async () => {
    const names = Array.from({ length: 21 }, (_, i) => `tag-${i}`)
    const res = await POST(mkReq({ names }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
    expect(tagRepository.findOrCreateMany).not.toHaveBeenCalled()
  })

  it('requires auth — returns 401 when unauthenticated', async () => {
    requireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(mkReq({ names: ['tag1'] }))
    expect(res.status).toBe(401)
    expect(tagRepository.findOrCreateMany).not.toHaveBeenCalled()
  })

  it('preserves input order in the response (regression guard)', async () => {
    // Repo returns tags in a different order than the input (simulates
    // Prisma `findMany` returning rows in DB insertion order, not `IN`-clause order).
    tagRepository.findOrCreateMany.mockResolvedValueOnce([
      { id: 'id-alpha', name: 'alpha', color: null },
      { id: 'id-mike', name: 'mike', color: null },
      { id: 'id-zulu', name: 'zulu', color: null },
    ])

    const res = await POST(mkReq({ names: ['zulu', 'alpha', 'mike'] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tags).toHaveLength(3)
    // Must match the INPUT order: zulu → alpha → mike
    expect(json.tags[0].id).toBe('id-zulu')
    expect(json.tags[1].id).toBe('id-alpha')
    expect(json.tags[2].id).toBe('id-mike')
  })

  it('returns 500 without leaking error details when the repository throws', async () => {
    tagRepository.findOrCreateMany.mockRejectedValueOnce(
      new Error('DB connection failed — secret details here')
    )

    const res = await POST(mkReq({ names: ['bug'] }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Internal server error')
    // Must not leak the underlying error message
    expect(JSON.stringify(json)).not.toContain('DB connection failed')
    expect(JSON.stringify(json)).not.toContain('secret details')
  })

  it('scopes to caller workspace — same name in two workspaces yields different ids', async () => {
    // First call: ws1
    tagRepository.findOrCreateMany.mockResolvedValueOnce([
      { id: 'ws1-tag-id', name: 'shared', color: null },
    ])

    const res1 = await POST(mkReq({ names: ['shared'] }))
    expect(res1.status).toBe(200)
    const json1 = await res1.json()
    expect(tagRepository.findOrCreateMany).toHaveBeenLastCalledWith('ws1', [
      'shared',
    ])
    expect(json1.tags[0].id).toBe('ws1-tag-id')

    // Second call: ws2
    requireUserWorkspace.mockResolvedValueOnce({ workspaceId: 'ws2' })
    tagRepository.findOrCreateMany.mockResolvedValueOnce([
      { id: 'ws2-tag-id', name: 'shared', color: null },
    ])

    const res2 = await POST(mkReq({ names: ['shared'] }))
    expect(res2.status).toBe(200)
    const json2 = await res2.json()
    expect(tagRepository.findOrCreateMany).toHaveBeenLastCalledWith('ws2', [
      'shared',
    ])
    expect(json2.tags[0].id).toBe('ws2-tag-id')

    // Different ids for same name
    expect(json1.tags[0].id).not.toBe(json2.tags[0].id)
  })
})
