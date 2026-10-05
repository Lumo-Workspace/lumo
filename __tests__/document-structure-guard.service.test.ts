/**
 * @jest-environment node
 *
 * LUM-410 — built-in structure guard on the document update path.
 *
 * The verify-live-doc.ts reconciliation moved server-side: a markdown body
 * update that drops tables/rows/headings versus the stored body is rejected
 * with 422 before anything is persisted, unless allowShrink is passed.
 * Section patches are judged at section scope (old section render vs new
 * section render) — structure elsewhere in the document never factors in —
 * and appends (pure insertion) are never guarded.
 */
import { documentService } from '@/lib/services/document.service'
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'

// ── Mock dependencies (same set as document-section-edit.service.test.ts) ───

const mockFindWithPermission = jest.fn()
const mockFindById = jest.fn()
const mockUpdateWithChildrenAndMentions = jest.fn()
const mockUpsertEditor = jest.fn()
const mockSyncDocumentTags = jest.fn()

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
    syncDocumentTags: (...args: any[]) => mockSyncDocumentTags(...args),
    addDocumentTags: jest.fn().mockResolvedValue(undefined),
    removeDocumentTags: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@/lib/services/documentRevision.service', () => ({
  documentRevisionService: {
    snapshotOnSave: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
    findByIdForMention: jest.fn(),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: {
      getUserList: jest.fn().mockResolvedValue({ data: [] }),
    },
  }),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {},
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

// Two sections; section A carries a table (1 table, 2 tr), three headings
// total — the structure the guard protects.
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
  '## B notes',
  '',
  'note body',
  '',
].join('\n')

function ownerDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    number: 7,
    title: 'Ledger',
    // Stored HTML is the render of the stored source (LUM-408 double-write).
    content: markdownToHtml(SRC),
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
  mockFindWithPermission.mockResolvedValue(ownerDoc())
  mockSyncDocumentTags.mockResolvedValue(undefined)
  mockUpsertEditor.mockResolvedValue(undefined)
  mockUpdateWithChildrenAndMentions.mockResolvedValue({
    id: 'doc-1',
    title: 'Ledger',
    emoji: null,
    slug: 'ledger-7',
    contentRevision: 5,
  })
})

// ── Full-document markdown updates ──────────────────────────────────────────

describe('structure guard — full-document markdown updates', () => {
  it('rejects an update that drops the table with 422 naming each shrunk category old→new', async () => {
    // The LUM-349 signature: the table flattened to prose.
    const flattened = SRC.replace(
      '| item | state |\n| ---- | ----- |\n| x    | open  |',
      'item x is open'
    )

    await expect(
      documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
        contentMarkdown: flattened,
        tagIds: ['t1'],
      })
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/table 1→0.*tr 2→0/),
    })

    // Rejected before anything is touched — tags included.
    expect(mockUpdateWithChildrenAndMentions).not.toHaveBeenCalled()
    expect(mockSyncDocumentTags).not.toHaveBeenCalled()
  })

  it('rejects an update that drops a section heading (heading count shrinks)', async () => {
    // The #460 signature: a stale base overwrite that loses a whole section.
    const lostSection = SRC.slice(0, SRC.indexOf('## B notes'))

    await expect(
      documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
        contentMarkdown: lostSection,
      })
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('heading 3→2'),
    })
  })

  it('allowShrink lets the same shrinking update through', async () => {
    const lostSection = SRC.slice(0, SRC.indexOf('## B notes'))

    await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
      contentMarkdown: lostSection,
      allowShrink: true,
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
    const updateData = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    expect(updateData.sourceMarkdown).toBe(lostSection)
  })

  it('a non-shrinking update (growth or same counts) passes without any flag', async () => {
    const grown = `${SRC}\n## C extra\n\n| a | b |\n| - | - |\n| 1 | 2 |\n`

    await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
      contentMarkdown: grown,
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
  })

  it('HTML-direct updates (web editor path) are never guarded', async () => {
    // The web editor saving a body with no tables/headings at all.
    await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
      content: '<p>rewritten interactively</p>',
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
  })

  it('a stale ifRevision still 409s first — concurrency conflict outranks the guard', async () => {
    const flattened = SRC.replace(/\|.*\n?/g, '')

    await expect(
      documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
        contentMarkdown: flattened,
        ifRevision: 3,
      })
    ).rejects.toMatchObject({ status: 409 })
  })
})

// ── Section-addressed edits ─────────────────────────────────────────────────

describe('structure guard — section scope', () => {
  it('rejects a patch that drops the table inside the addressed section', async () => {
    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'replace',
        section: 'A queue',
        contentMarkdown: '## A queue\n\nemptied\n',
      })
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/section.*table 1→0/),
    })
    expect(mockUpdateWithChildrenAndMentions).not.toHaveBeenCalled()
  })

  it('allowShrink lets the shrinking patch through', async () => {
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'replace',
      section: 'A queue',
      contentMarkdown: '## A queue\n\nemptied\n',
      allowShrink: true,
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
    const updateData = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    expect(updateData.sourceMarkdown).toContain('emptied')
    expect(updateData.sourceMarkdown).toContain('## B notes')
  })

  it('structure outside the addressed section never factors into the verdict', async () => {
    // Stored HTML drifted: it carries a table the markdown source does not
    // have (e.g. rendered by an older renderer). A full-document compare
    // would see table 1→0 and reject; the section-scoped compare must not.
    mockFindWithPermission.mockResolvedValue(
      ownerDoc({
        sourceMarkdown: '# Doc\n\n## B notes\n\nnote body\n',
        content:
          '<h1>Doc</h1><table><tr><td>phantom</td></tr></table><h2>B notes</h2><p>note body</p>',
      })
    )

    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'replace',
      section: 'B notes',
      contentMarkdown: '## B notes\n\nupdated body\n',
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
  })

  it('a patch that keeps the section structure passes without any flag', async () => {
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'replace',
      section: 'A queue',
      contentMarkdown:
        '## A queue\n\n| item | state |\n| ---- | ----- |\n| x    | done  |\n',
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
  })

  it('append is pure insertion and never triggers the guard', async () => {
    // Same drifted fixture as above — an append must not be blocked either.
    mockFindWithPermission.mockResolvedValue(
      ownerDoc({
        sourceMarkdown: '# Doc\n\n## B notes\n\nnote body\n',
        content:
          '<h1>Doc</h1><table><tr><td>phantom</td></tr></table><h2>B notes</h2><p>note body</p>',
      })
    )

    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'append',
      section: 'B notes',
      contentMarkdown: 'tail line',
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
  })
})
