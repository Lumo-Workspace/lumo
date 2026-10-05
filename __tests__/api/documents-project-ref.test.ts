/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByWorkspaceNonIdea: jest.fn() },
}))
jest.mock('@/lib/services', () => ({
  documentService: {
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    deleteDocument: jest.fn(),
  },
}))

import { POST } from '@/app/api/documents/route'
import { PATCH } from '@/app/api/documents/[id]/route'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories/project.repository'
import { documentService } from '@/lib/services'

const mockIdentity = requireIdentity as jest.Mock
const mockFindProjects = projectRepository.findByWorkspaceNonIdea as jest.Mock
const mockCreateDoc = documentService.createDocument as jest.Mock
const mockUpdateDoc = documentService.updateDocument as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({
    clerkId: 'user_1',
    memberId: 'member_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'lumo',
    workspaceName: 'Lumo',
    source: 'bearer',
  })
  mockCreateDoc.mockResolvedValue({ id: 'doc_1', title: 'T' })
  mockUpdateDoc.mockResolvedValue({ id: 'doc_1', title: 'T' })
})

function mkPostReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function mkPatchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/documents — projectRef resolution', () => {
  it('resolves projectRef by name (case-insensitive)', async () => {
    mockFindProjects.mockResolvedValueOnce([
      { id: 'proj_1', name: 'Lumo', description: null },
      { id: 'proj_2', name: 'Other', description: null },
    ])
    const res = await POST(
      mkPostReq({ title: 'Doc', visibility: 'PRIVATE', projectRef: 'lumo' })
    )
    expect(res.status).toBe(201)
    expect(mockCreateDoc).toHaveBeenCalledWith(
      'ws_1',
      'member_1',
      expect.objectContaining({ projectId: 'proj_1' })
    )
  })

  it('resolves projectRef by slug (multi-word name)', async () => {
    mockFindProjects.mockResolvedValueOnce([
      { id: 'proj_1', name: 'My Cool Project', description: null },
    ])
    const res = await POST(
      mkPostReq({
        title: 'Doc',
        visibility: 'PRIVATE',
        projectRef: 'my-cool-project',
      })
    )
    expect(res.status).toBe(201)
    expect(mockCreateDoc).toHaveBeenCalledWith(
      'ws_1',
      'member_1',
      expect.objectContaining({ projectId: 'proj_1' })
    )
  })

  it('returns 404 with the ref echoed when no project matches', async () => {
    mockFindProjects.mockResolvedValueOnce([
      { id: 'proj_1', name: 'Lumo', description: null },
    ])
    const res = await POST(
      mkPostReq({ title: 'Doc', visibility: 'PRIVATE', projectRef: 'ghost' })
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/ghost/)
    expect(mockCreateDoc).not.toHaveBeenCalled()
  })

  it('passes projectId through when projectRef is absent', async () => {
    const res = await POST(
      mkPostReq({
        title: 'Doc',
        visibility: 'PRIVATE',
        projectId: 'cmosi2sql000004lboufz7wex',
      })
    )
    expect(res.status).toBe(201)
    expect(mockCreateDoc).toHaveBeenCalledWith(
      'ws_1',
      'member_1',
      expect.objectContaining({ projectId: 'cmosi2sql000004lboufz7wex' })
    )
    expect(mockFindProjects).not.toHaveBeenCalled()
  })

  it('files doc with null project when neither projectId nor projectRef is given', async () => {
    const res = await POST(mkPostReq({ title: 'Doc', visibility: 'PRIVATE' }))
    expect(res.status).toBe(201)
    expect(mockCreateDoc).toHaveBeenCalledWith(
      'ws_1',
      'member_1',
      expect.objectContaining({ projectId: null })
    )
  })
})

describe('PATCH /api/documents/[id] — projectRef resolution', () => {
  const params = { params: Promise.resolve({ id: 'doc_1' }) }

  it('resolves projectRef by name', async () => {
    mockFindProjects.mockResolvedValueOnce([
      { id: 'proj_1', name: 'Lumo', description: null },
    ])
    const res = await PATCH(mkPatchReq({ projectRef: 'Lumo' }), params)
    expect(res.status).toBe(200)
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      'doc_1',
      'member_1',
      'ws_1',
      expect.objectContaining({ projectId: 'proj_1' }),
      { audit: expect.objectContaining({ source: 'CLI' }) }
    )
  })

  it('clears project binding when projectRef is null', async () => {
    const res = await PATCH(mkPatchReq({ projectRef: null }), params)
    expect(res.status).toBe(200)
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      'doc_1',
      'member_1',
      'ws_1',
      expect.objectContaining({ projectId: null }),
      { audit: expect.objectContaining({ source: 'CLI' }) }
    )
    expect(mockFindProjects).not.toHaveBeenCalled()
  })

  it('returns 404 when projectRef does not match', async () => {
    mockFindProjects.mockResolvedValueOnce([
      { id: 'proj_1', name: 'Lumo', description: null },
    ])
    const res = await PATCH(mkPatchReq({ projectRef: 'nope' }), params)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/nope/)
    expect(mockUpdateDoc).not.toHaveBeenCalled()
  })

  it('falls back to projectId when projectRef is absent', async () => {
    const res = await PATCH(
      mkPatchReq({ projectId: 'cmosi2sql000004lboufz7wex' }),
      params
    )
    expect(res.status).toBe(200)
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      'doc_1',
      'member_1',
      'ws_1',
      expect.objectContaining({ projectId: 'cmosi2sql000004lboufz7wex' }),
      { audit: expect.objectContaining({ source: 'CLI' }) }
    )
    expect(mockFindProjects).not.toHaveBeenCalled()
  })

  it('does not touch projectId when neither projectRef nor projectId is provided', async () => {
    const res = await PATCH(mkPatchReq({ title: 'Renamed' }), params)
    expect(res.status).toBe(200)
    const callArgs = mockUpdateDoc.mock.calls[0]
    expect(callArgs[3]).not.toHaveProperty('projectId')
    expect(callArgs[3]).toHaveProperty('title', 'Renamed')
  })
})
