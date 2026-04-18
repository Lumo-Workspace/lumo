import { makeDocumentHandlers } from '@/lib/mcp/tools/documents'

const mockListDocuments = jest.fn()
const mockGetDocument = jest.fn()

jest.mock('@/lib/services/document.service', () => ({
  documentService: {
    listDocuments: (...a: any[]) => mockListDocuments(...a),
    getDocument: (...a: any[]) => mockGetDocument(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

const boundCtx = {
  clerkUserId: 'u1',
  connectionId: 'c1',
  workspaceId: 'ws-1',
  memberId: 'm-1',
  memberRole: 'MEMBER' as const,
}

describe('list_documents', () => {
  it('delegates to documentService.listDocuments with workspaceId and memberId', async () => {
    mockListDocuments.mockResolvedValue([{ id: 'doc-1', title: 'Test Doc' }])
    const h = makeDocumentHandlers(async () => boundCtx)
    const out = await h.list_documents()
    expect(mockListDocuments).toHaveBeenCalledWith('ws-1', 'm-1')
    expect(out.documents).toHaveLength(1)
    expect(out.documents[0]?.id).toBe('doc-1')
  })

  it('throws WORKSPACE_REQUIRED when context has no workspaceId', async () => {
    const bootstrapCtx = { clerkUserId: 'u1', connectionId: 'c1' }
    const h = makeDocumentHandlers(async () => bootstrapCtx as any)
    await expect(h.list_documents()).rejects.toMatchObject({
      code: 'WORKSPACE_REQUIRED',
    })
  })
})

describe('get_document', () => {
  it('delegates to documentService.getDocument with (id, memberId, workspaceId)', async () => {
    mockGetDocument.mockResolvedValue({ id: 'doc-1', title: 'Test Doc' })
    const h = makeDocumentHandlers(async () => boundCtx)
    const out = await h.get_document({ documentId: 'doc-1' })
    expect(mockGetDocument).toHaveBeenCalledWith('doc-1', 'm-1', 'ws-1')

    expect((out.document as any).id).toBe('doc-1')
  })

  it('propagates 404 for missing or inaccessible document', async () => {
    mockGetDocument.mockRejectedValue(
      Object.assign(new Error('Document not found'), { status: 404 })
    )
    const h = makeDocumentHandlers(async () => boundCtx)
    await expect(
      h.get_document({ documentId: 'doc-other' })
    ).rejects.toMatchObject({ status: 404 })
  })
})
