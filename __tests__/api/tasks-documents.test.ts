/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/tasks/[id]/documents/route'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  miscRepository: {
    findDocumentMentionsByTask: jest.fn(),
  },
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
  },
}))

const { requireAuth } = jest.requireMock('@/lib/auth') as {
  requireAuth: jest.Mock
}
const { requireUserWorkspace } = jest.requireMock('@/lib/api/helpers') as {
  requireUserWorkspace: jest.Mock
}
const { miscRepository, taskRepository } = jest.requireMock(
  '@/lib/repositories'
) as {
  miscRepository: { findDocumentMentionsByTask: jest.Mock }
  taskRepository: { findByWorkspaceIdentifier: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  requireAuth.mockResolvedValue({ userId: 'user_clerk_1' })
  requireUserWorkspace.mockResolvedValue({
    workspaceId: 'ws1',
    member: { id: 'member1' },
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
