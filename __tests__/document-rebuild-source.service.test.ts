/**
 * @jest-environment node
 *
 * LUM-446 — documentService.rebuildDocumentSource. Pins the recovery-path
 * invariants: a source-less doc gets a freshly serialized markdown source
 * backfilled into ONLY the sourceMarkdown column (the body is untouched), the
 * structure guard is wired (a lossless rebuild commits), and the safety gates
 * (already-has-source 409, permission 403, revision 409, empty body 422) hold.
 */
import { documentService } from '@/lib/services/document.service'

const mockFindWithPermission = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: (...args: any[]) => mockFindWithPermission(...args),
    update: (...args: any[]) => mockUpdate(...args),
    findNodeWithChildren: jest.fn().mockResolvedValue(null),
  },
}))

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByDocument: jest.fn().mockResolvedValue([]),
    syncDocumentTags: jest.fn().mockResolvedValue(undefined),
    addDocumentTags: jest.fn().mockResolvedValue(undefined),
    removeDocumentTags: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@/lib/services/documentRevision.service', () => ({
  documentRevisionService: { snapshotOnSave: jest.fn() },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
    findByIdForMention: jest.fn(),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: { getUserList: jest.fn().mockResolvedValue({ data: [] }) },
  }),
}))

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

// A Tiptap-shaped body with a table + headings — the structure the guard
// protects and the lossy default render would flatten.
const BODY_HTML = [
  '<h1>Registry</h1>',
  '<table><tbody>',
  '<tr><th><p>ID</p></th><th><p>State</p></th></tr>',
  '<tr><td><p>LUM-1</p></td><td><p>open</p></td></tr>',
  '</tbody></table>',
].join('\n')

function sourcelessDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    number: 7,
    title: 'Registry',
    content: BODY_HTML,
    sourceMarkdown: null,
    contentRevision: 4,
    createdById: 'm-1',
    shares: [],
    parentId: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindWithPermission.mockResolvedValue(sourcelessDoc())
  mockUpdate.mockImplementation(
    (id: string, data: Record<string, unknown>) => ({
      id,
      title: 'Registry',
      contentRevision: 4,
      ...data,
    })
  )
})

describe('rebuildDocumentSource (LUM-446)', () => {
  it('backfills ONLY sourceMarkdown for a source-less doc — body untouched', async () => {
    const result = await documentService.rebuildDocumentSource(
      'doc-1',
      'm-1',
      'ws-1'
    )

    // Exactly one write, carrying only the source column (no content/revision).
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const [, , writeData] = mockUpdate.mock.calls[0]
    expect(Object.keys(writeData)).toEqual(['sourceMarkdown'])
    expect(typeof writeData.sourceMarkdown).toBe('string')

    // The rebuilt source is a real GFM table (round-trips, not flattened).
    expect(writeData.sourceMarkdown).toMatch(/\|\s*-{3,}\s*\|/)
    expect(result.sourceMarkdown).toBe(writeData.sourceMarkdown)
    expect(result.sourceBytes).toBeGreaterThan(0)
  })

  it('refuses with 409 when a source already exists, unless force', async () => {
    mockFindWithPermission.mockResolvedValue(
      sourcelessDoc({ sourceMarkdown: '# human-authored\n' })
    )

    await expect(
      documentService.rebuildDocumentSource('doc-1', 'm-1', 'ws-1')
    ).rejects.toMatchObject({ status: 409 })
    expect(mockUpdate).not.toHaveBeenCalled()

    // --force re-derives over the existing source.
    await documentService.rebuildDocumentSource('doc-1', 'm-1', 'ws-1', {
      force: true,
    })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('rejects a viewer (403) and a missing doc (404)', async () => {
    mockFindWithPermission.mockResolvedValue(
      sourcelessDoc({
        createdById: 'someone-else',
        shares: [{ memberId: 'm-1', role: 'VIEWER' }],
      })
    )
    await expect(
      documentService.rebuildDocumentSource('doc-1', 'm-1', 'ws-1')
    ).rejects.toMatchObject({ status: 403 })

    mockFindWithPermission.mockResolvedValue(null)
    await expect(
      documentService.rebuildDocumentSource('doc-1', 'm-1', 'ws-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('409s on a revision mismatch before writing', async () => {
    await expect(
      documentService.rebuildDocumentSource('doc-1', 'm-1', 'ws-1', {
        ifRevision: 1,
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('422s when the body is empty (nothing to rebuild from)', async () => {
    mockFindWithPermission.mockResolvedValue(sourcelessDoc({ content: '' }))
    await expect(
      documentService.rebuildDocumentSource('doc-1', 'm-1', 'ws-1')
    ).rejects.toMatchObject({ status: 422 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
