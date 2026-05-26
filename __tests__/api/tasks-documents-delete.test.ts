/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { DELETE } from '@/app/api/tasks/[id]/documents/[documentId]/route'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services', () => ({
  documentService: {
    removeExplicitMention: jest.fn(),
  },
}))

const { requireIdentity } = jest.requireMock('@/lib/auth') as {
  requireIdentity: jest.Mock
}
const { taskRepository } = jest.requireMock('@/lib/repositories') as {
  taskRepository: { findByWorkspaceIdentifier: jest.Mock }
}
const { documentService } = jest.requireMock('@/lib/services') as {
  documentService: { removeExplicitMention: jest.Mock }
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
  // Default: LUM-N lookups resolve to a real task.
  taskRepository.findByWorkspaceIdentifier.mockResolvedValue({ id: 'tsk_42' })
})

function mkDelReq(id: string, documentId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/tasks/${id}/documents/${documentId}`,
    { method: 'DELETE' }
  )
}

describe('DELETE /api/tasks/[id]/documents/[documentId]', () => {
  it('removes an EXPLICIT mention and returns 200 with the right service args', async () => {
    documentService.removeExplicitMention.mockResolvedValueOnce({
      removed: 1,
      refused: false,
      taskIdentifier: 'LUM-42',
    })

    const res = await DELETE(mkDelReq('LUM-42', 'cld7z3k2m0000abc12345678x'), {
      params: Promise.resolve({
        id: 'LUM-42',
        documentId: 'cld7z3k2m0000abc12345678x',
      }),
    })

    expect(res.status).toBe(200)
    expect(documentService.removeExplicitMention).toHaveBeenCalledWith(
      'cld7z3k2m0000abc12345678x',
      'LUM-42',
      'ws1',
      'member1'
    )
    const json = await res.json()
    expect(json).toEqual({ removed: 1 })
  })

  it('returns 409 + CONTENT_MENTION_ONLY when the mention is content-only', async () => {
    documentService.removeExplicitMention.mockResolvedValueOnce({
      removed: 0,
      refused: true,
      reason:
        'Cannot unbind a content-derived mention; remove the @LUM-N from the doc body instead.',
      taskIdentifier: 'LUM-42',
    })

    const res = await DELETE(mkDelReq('LUM-42', 'cld7z3k2m0000abc12345678x'), {
      params: Promise.resolve({
        id: 'LUM-42',
        documentId: 'cld7z3k2m0000abc12345678x',
      }),
    })

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('CONTENT_MENTION_ONLY')
    expect(json.error).toMatch(/content-derived/)
  })

  it('returns 404 when the LUM-N task does not exist in the workspace', async () => {
    taskRepository.findByWorkspaceIdentifier.mockResolvedValueOnce(null)

    const res = await DELETE(mkDelReq('LUM-999', 'cld7z3k2m0000abc12345678x'), {
      params: Promise.resolve({
        id: 'LUM-999',
        documentId: 'cld7z3k2m0000abc12345678x',
      }),
    })

    expect(res.status).toBe(404)
    expect(documentService.removeExplicitMention).not.toHaveBeenCalled()
  })

  it('forwards service-thrown status codes (e.g. 403 from VIEWER role)', async () => {
    documentService.removeExplicitMention.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { status: 403 })
    )

    const res = await DELETE(mkDelReq('LUM-42', 'cld7z3k2m0000abc12345678x'), {
      params: Promise.resolve({
        id: 'LUM-42',
        documentId: 'cld7z3k2m0000abc12345678x',
      }),
    })

    expect(res.status).toBe(403)
  })
})
