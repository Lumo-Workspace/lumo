/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/tasks/[id]/documents/route'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  miscRepository: {
    findDocumentMentionsByTask: jest.fn(),
  },
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services', () => ({
  documentService: {
    addExplicitMention: jest.fn(),
  },
}))

const { requireIdentity } = jest.requireMock('@/lib/auth') as {
  requireIdentity: jest.Mock
}
const { miscRepository, taskRepository } = jest.requireMock(
  '@/lib/repositories'
) as {
  miscRepository: { findDocumentMentionsByTask: jest.Mock }
  taskRepository: { findByWorkspaceIdentifier: jest.Mock }
}
const { documentService } = jest.requireMock('@/lib/services') as {
  documentService: { addExplicitMention: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  requireIdentity.mockResolvedValue({
    clerkId: 'user_clerk_1',
    memberId: 'member1',
    workspaceId: 'ws1',
    workspaceSlug: 'ws',
    workspaceName: 'WS',
    source: 'clerk',
  })
  miscRepository.findDocumentMentionsByTask.mockResolvedValue([])
})

function mkGetReq(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}/documents`)
}

describe('GET /api/tasks/[id]/documents', () => {
  it('resolves a cuid segment directly without calling findByWorkspaceIdentifier', async () => {
    const cuid = 'cld7z3k2m0000abc12345678x'
    const res = await GET(mkGetReq(cuid), {
      params: Promise.resolve({ id: cuid }),
    })
    expect(res.status).toBe(200)
    expect(taskRepository.findByWorkspaceIdentifier).not.toHaveBeenCalled()
    expect(miscRepository.findDocumentMentionsByTask).toHaveBeenCalledWith(
      cuid,
      'ws1',
      'member1'
    )
  })

  it('resolves a LUM-N identifier to a cuid via taskRepository', async () => {
    taskRepository.findByWorkspaceIdentifier.mockResolvedValueOnce({
      id: 'cld7z3k2m0000abc12345678x',
    })
    miscRepository.findDocumentMentionsByTask.mockResolvedValueOnce([
      {
        document: {
          id: 'doc1',
          title: 'Sprint notes',
          emoji: null,
          updatedAt: new Date().toISOString(),
        },
      },
    ])

    const res = await GET(mkGetReq('LUM-42'), {
      params: Promise.resolve({ id: 'LUM-42' }),
    })
    expect(res.status).toBe(200)
    expect(taskRepository.findByWorkspaceIdentifier).toHaveBeenCalledWith(
      'ws1',
      'LUM',
      42
    )
    expect(miscRepository.findDocumentMentionsByTask).toHaveBeenCalledWith(
      'cld7z3k2m0000abc12345678x',
      'ws1',
      'member1'
    )
    const json = await res.json()
    expect(json.documents).toHaveLength(1)
    expect(json.documents[0].id).toBe('doc1')
  })

  it('returns 404 when LUM-N identifier does not exist', async () => {
    taskRepository.findByWorkspaceIdentifier.mockResolvedValueOnce(null)

    const res = await GET(mkGetReq('LUM-999'), {
      params: Promise.resolve({ id: 'LUM-999' }),
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/Task not found/)
  })

  it('returns 404 for a malformed segment that is neither cuid nor identifier', async () => {
    const res = await GET(mkGetReq('not-valid'), {
      params: Promise.resolve({ id: 'not-valid' }),
    })
    expect(res.status).toBe(404)
  })
})

function mkPostReq(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}/documents`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/tasks/[id]/documents', () => {
  beforeEach(() => {
    documentService.addExplicitMention.mockResolvedValue({
      documentId: 'cld7z3k2m0000abc12345678x',
      taskId: 'tsk_42',
      taskIdentifier: 'LUM-42',
      source: 'EXPLICIT',
      alreadyBound: false,
      upgradedFromContent: false,
    })
    // Default: LUM-N lookups in POST suite resolve to a real task.
    taskRepository.findByWorkspaceIdentifier.mockResolvedValue({
      id: 'tsk_42',
    })
  })

  it('attaches by documentId for a LUM-N task and forwards identifier to service', async () => {
    const res = await POST(
      mkPostReq('LUM-42', { documentId: 'cld7z3k2m0000abc12345678x' }),
      {
        params: Promise.resolve({ id: 'LUM-42' }),
      }
    )
    expect(res.status).toBe(200)
    expect(documentService.addExplicitMention).toHaveBeenCalledWith(
      'cld7z3k2m0000abc12345678x',
      'LUM-42',
      'ws1',
      'member1'
    )
    const json = await res.json()
    expect(json).toEqual({
      documentId: 'cld7z3k2m0000abc12345678x',
      alreadyBound: false,
      upgradedFromContent: false,
    })
  })

  it('attaches by documentId for a cuid task id (passes raw id to service)', async () => {
    const cuid = 'cld7z3k2m0000abc12345678x'
    const res = await POST(
      mkPostReq(cuid, { documentId: 'cld7z3k2m0000abc12345678x' }),
      {
        params: Promise.resolve({ id: cuid }),
      }
    )
    expect(res.status).toBe(200)
    expect(documentService.addExplicitMention).toHaveBeenCalledWith(
      'cld7z3k2m0000abc12345678x',
      cuid,
      'ws1',
      'member1'
    )
  })

  it('returns 400 when both identifier and documentId are supplied', async () => {
    const res = await POST(
      mkPostReq('LUM-42', {
        identifier: 'foo',
        documentId: 'cld7z3k2m0000abc12345678x',
      }),
      { params: Promise.resolve({ id: 'LUM-42' }) }
    )
    expect(res.status).toBe(400)
    expect(documentService.addExplicitMention).not.toHaveBeenCalled()
  })

  it('returns 400 when neither identifier nor documentId is supplied', async () => {
    const res = await POST(mkPostReq('LUM-42', {}), {
      params: Promise.resolve({ id: 'LUM-42' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the LUM-N task does not exist in the workspace', async () => {
    taskRepository.findByWorkspaceIdentifier.mockResolvedValueOnce(null)
    const res = await POST(
      mkPostReq('LUM-999', { documentId: 'cld7z3k2m0000abc12345678x' }),
      { params: Promise.resolve({ id: 'LUM-999' }) }
    )
    expect(res.status).toBe(404)
    expect(documentService.addExplicitMention).not.toHaveBeenCalled()
  })

  it('forwards service-thrown status codes (e.g. 403 from VIEWER role)', async () => {
    documentService.addExplicitMention.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { status: 403 })
    )
    const res = await POST(
      mkPostReq('LUM-42', { documentId: 'cld7z3k2m0000abc12345678x' }),
      {
        params: Promise.resolve({ id: 'LUM-42' }),
      }
    )
    expect(res.status).toBe(403)
  })

  it('resolves document URL containing /documents/<slug-N> to slug', async () => {
    const res = await POST(
      mkPostReq('LUM-42', {
        identifier: 'https://app.example.com/w/acme/documents/sprint-notes-3',
      }),
      { params: Promise.resolve({ id: 'LUM-42' }) }
    )
    expect(res.status).toBe(200)
    expect(documentService.addExplicitMention).toHaveBeenCalledWith(
      'sprint-notes-3',
      'LUM-42',
      'ws1',
      'member1'
    )
  })

  it('resolves cuid identifier directly', async () => {
    const res = await POST(
      mkPostReq('LUM-42', { identifier: 'ckg4t7000000abc12345678yz' }),
      { params: Promise.resolve({ id: 'LUM-42' }) }
    )
    expect(res.status).toBe(200)
    expect(documentService.addExplicitMention).toHaveBeenCalledWith(
      'ckg4t7000000abc12345678yz',
      'LUM-42',
      'ws1',
      'member1'
    )
  })

  it('resolves slug-N identifier directly', async () => {
    const res = await POST(
      mkPostReq('LUM-42', { identifier: 'sprint-notes-3' }),
      { params: Promise.resolve({ id: 'LUM-42' }) }
    )
    expect(res.status).toBe(200)
    expect(documentService.addExplicitMention).toHaveBeenCalledWith(
      'sprint-notes-3',
      'LUM-42',
      'ws1',
      'member1'
    )
  })

  it('returns 404 when identifier cannot be parsed', async () => {
    const res = await POST(
      mkPostReq('LUM-42', { identifier: 'totally bogus' }),
      { params: Promise.resolve({ id: 'LUM-42' }) }
    )
    expect(res.status).toBe(404)
  })
})
