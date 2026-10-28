/**
 * @jest-environment node
 *
 * LUM-444 — end-of-document `doc append` must NOT depend on a byte-faithful
 * stored markdown source. When `sourceMarkdown` is null (web HTML edit /
 * revision restore / legacy doc) a single web operation used to lock EVERY
 * agent write path (append/patch/--raw/--section/diff) out of the document.
 *
 * Fix: a sectionless append is pure tail insertion — render the new block to
 * HTML and concatenate it onto the stored HTML body. Section-addressed edits
 * and patches genuinely need the source to locate boundaries and stay 400.
 *
 * Invariants pinned here:
 *   1. no stored source → end append still succeeds (new content at body end)
 *   2. pure insertion: no pre-existing body byte modified; source-present
 *      behavior does not regress (still the markdown-splice path).
 */
import { documentService } from '@/lib/services/document.service'
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'

// ── Mocks (same dependency set as document-section-edit.service.test.ts) ─────

const mockFindWithPermission = jest.fn()
const mockFindById = jest.fn()
const mockUpdateWithChildrenAndMentions = jest.fn()
const mockUpsertEditor = jest.fn()

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: (...args: any[]) => mockFindWithPermission(...args),
    findById: (...args: any[]) => mockFindById(...args),
    updateWithChildrenAndMentions: (...args: any[]) =>
      mockUpdateWithChildrenAndMentions(...args),
    upsertEditor: (...args: any[]) => mockUpsertEditor(...args),
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

const mockSnapshotOnSave = jest.fn()
jest.mock('@/lib/services/documentRevision.service', () => ({
  documentRevisionService: {
    snapshotOnSave: (...a: any[]) => mockSnapshotOnSave(...a),
  },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
    findByIdForMention: jest.fn(),
  },
}))

jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn().mockResolvedValue({
    getUserList: jest.fn().mockResolvedValue({ data: [] }),
  }),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {},
}))

// ── Fixture ──────────────────────────────────────────────────────────────────

const SRC = [
  '# Ledger',
  '',
  'intro',
  '',
  '## A queue',
  '',
  '| item | state |',
  '| ---- | ----- |',
  '| x    | open  |',
  '',
].join('\n')

// An HTML body with no recoverable markdown source — what a web HTML edit or
// a revision restore leaves behind. Contains a table so we can also confirm
// the existing structure is carried over verbatim.
const HTML_BODY =
  '<h1>Ledger</h1><table><tbody><tr><td>x</td><td>open</td></tr></tbody></table>'

function ownerDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    number: 7,
    title: 'Ledger',
    content: HTML_BODY,
    sourceMarkdown: SRC,
    contentRevision: 4,
    createdById: 'm-1',
    shares: [],
    parentId: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSnapshotOnSave.mockResolvedValue(undefined)
  mockFindWithPermission.mockResolvedValue(ownerDoc())
  mockUpdateWithChildrenAndMentions.mockResolvedValue({
    id: 'doc-1',
    title: 'Ledger',
    emoji: null,
    slug: 'ledger-7',
    contentRevision: 5,
  })
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('doc append without a stored markdown source (LUM-444)', () => {
  it('doc append end-insertion works without a stored markdown source', async () => {
    mockFindWithPermission.mockResolvedValue(
      ownerDoc({ sourceMarkdown: null, content: HTML_BODY })
    )

    const block = '## C new\n\nfresh tail'
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'append',
      contentMarkdown: block,
    })

    // It committed (did not 400 like patch/section edits do without a source).
    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
    const updateData = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]

    // New content lands at the end of the existing HTML body.
    expect(updateData.content.startsWith(HTML_BODY)).toBe(true)
    const rendered = markdownToHtml(block)
    expect(updateData.content).toContain(rendered)
    expect(updateData.content).toContain('fresh tail')

    // No phantom markdown source is invented — the body remains HTML-only.
    expect(updateData.sourceMarkdown).toBeNull()
  })

  it('doc append stays pure insertion and unchanged when a source exists', async () => {
    // (a) No source: every pre-existing byte of the HTML body is preserved and
    //     only new bytes are appended — pure insertion.
    mockFindWithPermission.mockResolvedValue(
      ownerDoc({ sourceMarkdown: null, content: HTML_BODY })
    )
    const block = '## C new\n\nfresh tail'
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'append',
      contentMarkdown: block,
    })
    const noSrc = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    expect(noSrc.content.startsWith(HTML_BODY)).toBe(true)
    // The appended tail is exactly the rendered block (plus separator) — the
    // original bytes are untouched, nothing in between was rewritten.
    const tail = noSrc.content.slice(HTML_BODY.length)
    expect(tail).toContain(markdownToHtml(block))
    expect(tail).not.toContain('open') // didn't re-render the original table

    // (b) Source present: the end-append path is unchanged — it still splices
    //     the markdown source and double-writes it (no regression to HTML-only).
    jest.clearAllMocks()
    mockSnapshotOnSave.mockResolvedValue(undefined)
    mockFindWithPermission.mockResolvedValue(ownerDoc())
    mockUpdateWithChildrenAndMentions.mockResolvedValue({
      id: 'doc-1',
      title: 'Ledger',
      emoji: null,
      slug: 'ledger-7',
      contentRevision: 5,
    })
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'append',
      contentMarkdown: '## C new\n\nfresh tail',
    })
    const withSrc = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    expect(withSrc.sourceMarkdown).not.toBeNull()
    expect((withSrc.sourceMarkdown as string).startsWith(SRC)).toBe(true)
    expect(withSrc.sourceMarkdown).toContain('## C new')
    // Double-write invariant holds: stored HTML rendered from the full source.
    expect(withSrc.content).toBe(
      markdownToHtml(withSrc.sourceMarkdown as string)
    )
  })

  it('section-addressed append without a source still 400s (boundary: out of scope)', async () => {
    mockFindWithPermission.mockResolvedValue(
      ownerDoc({ sourceMarkdown: null, content: HTML_BODY })
    )
    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'append',
        section: 'A queue',
        contentMarkdown: 'x',
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(mockUpdateWithChildrenAndMentions).not.toHaveBeenCalled()
  })

  it('end append on a sourceless doc still honors the revision precondition (409)', async () => {
    mockFindWithPermission.mockResolvedValue(
      ownerDoc({ sourceMarkdown: null, content: HTML_BODY })
    )
    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'append',
        contentMarkdown: 'tail',
        ifRevision: 3,
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockUpdateWithChildrenAndMentions).not.toHaveBeenCalled()
  })
})
