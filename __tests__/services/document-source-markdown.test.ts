/**
 * LUM-408 — storage-level markdown source of truth.
 *
 * The document body has two write shapes: markdown (CLI/API contentMarkdown,
 * gdoc import/sync) and HTML-direct (web editor, revision restore). Markdown
 * writes must double-write the byte-identical source into
 * Document.sourceMarkdown; HTML-direct writes must invalidate it so
 * `doc show --raw` can never serve a stale source.
 */
import { documentService } from '@/lib/services/document.service'
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockFindWithPermission = jest.fn()
const mockGetMaxSortOrder = jest.fn()
const mockCreate = jest.fn()
const mockUpsertEditor = jest.fn()
const mockUpdateWithChildrenAndMentions = jest.fn()

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: (...args: any[]) => mockFindWithPermission(...args),
    getMaxSortOrder: (...args: any[]) => mockGetMaxSortOrder(...args),
    create: (...args: any[]) => mockCreate(...args),
    upsertEditor: (...args: any[]) => mockUpsertEditor(...args),
    updateWithChildrenAndMentions: (...args: any[]) =>
      mockUpdateWithChildrenAndMentions(...args),
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

const mockSnapshotOnSave = jest.fn()
jest.mock('@/lib/services/documentRevision.service', () => ({
  documentRevisionService: {
    snapshotOnSave: (...a: any[]) => mockSnapshotOnSave(...a),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: {
      getUserList: jest.fn().mockResolvedValue({ data: [] }),
    },
  }),
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

// A table is the LUM-349 incident shape: it survives markdown→HTML rendering
// but NOT the HTML→markdown reverse render, so it is exactly what the
// byte-identical source column has to preserve. The blank line inside the
// fence and trailing spaces exercise byte-fidelity beyond structure.
const MARKDOWN_SOURCE = [
  '# Title',
  '',
  '| col A | col B |',
  '| ----- | ----- |',
  '| a1    | b1    |',
  '',
  '```ts',
  'const x = 1',
  '',
  '```',
  'trailing spaces  ',
].join('\n')

const EXISTING_DOC = {
  id: 'doc-1',
  number: 7,
  title: 'Existing',
  content: '<p>old</p>',
  createdById: 'm-1',
  shares: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSnapshotOnSave.mockResolvedValue(undefined)
  mockGetMaxSortOrder.mockResolvedValue(0)
  mockCreate.mockImplementation(async (data: any) => ({
    ...data,
    id: 'doc-new',
    createdBy: { id: 'm-1', clerkId: 'clerk-1' },
  }))
  mockFindWithPermission.mockResolvedValue(EXISTING_DOC)
  mockUpdateWithChildrenAndMentions.mockResolvedValue({
    id: 'doc-1',
    title: 'Existing',
    emoji: null,
    slug: 'existing-7',
  })
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('documentService sourceMarkdown (LUM-408)', () => {
  it('double-write: createDocument persists the byte-identical markdown source alongside rendered HTML', async () => {
    await documentService.createDocument('ws-1', 'm-1', {
      title: 'Doc',
      visibility: 'PRIVATE',
      contentMarkdown: MARKDOWN_SOURCE,
    })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const created = mockCreate.mock.calls[0]![0]
    expect(created.sourceMarkdown).toBe(MARKDOWN_SOURCE)
    expect(created.content).toBe(markdownToHtml(MARKDOWN_SOURCE))
  })

  it('double-write: createDocument without a body or from a template leaves sourceMarkdown unset', async () => {
    await documentService.createDocument('ws-1', 'm-1', {
      title: 'Empty',
      visibility: 'PRIVATE',
    })
    expect(mockCreate.mock.calls[0]![0].sourceMarkdown).toBeUndefined()
  })

  it('double-write: updateDocument with contentMarkdown persists the byte-identical markdown source', async () => {
    await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
      contentMarkdown: MARKDOWN_SOURCE,
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
    const updateData = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    expect(updateData.sourceMarkdown).toBe(MARKDOWN_SOURCE)
    expect(updateData.content).toBe(markdownToHtml(MARKDOWN_SOURCE))
  })

  it('invalidates sourceMarkdown when content is replaced through the HTML-direct path', async () => {
    await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
      content: '<p>edited in the web editor</p>',
    })

    const updateData = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    expect(updateData.sourceMarkdown).toBeNull()
    expect(updateData.content).toBe('<p>edited in the web editor</p>')
  })

  it('leaves sourceMarkdown untouched on updates that do not carry a body', async () => {
    await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
      title: 'Renamed',
    })

    const updateData = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    expect('sourceMarkdown' in updateData).toBe(false)
  })
})
