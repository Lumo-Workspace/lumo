/**
 * @jest-environment node
 *
 * LUM-409 — section-addressed body edits. Pins the two write invariants:
 *   patch  → only the addressed section's bytes change; HTML re-rendered
 *            from the FULL new markdown (double-write stays in sync)
 *   append → pure insertion at section end; no pre-existing byte modified
 */
import { documentService } from '@/lib/services/document.service'
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'

// ── Mock dependencies (same set as document.service.test.ts) ────────────────

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

// ── Fixture ─────────────────────────────────────────────────────────────────

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
    content: '<h1>Ledger</h1>',
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('section patch (mode: replace)', () => {
  it('replaces only the addressed section — every byte outside it is unchanged', async () => {
    const newSection =
      '## A queue\n\n| item | state |\n| ---- | ----- |\n| x    | done  |\n'
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'replace',
      section: 'A queue',
      contentMarkdown: newSection,
    })

    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledTimes(1)
    const updateData = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    const next = updateData.sourceMarkdown as string

    const prefix = SRC.slice(0, SRC.indexOf('## A queue'))
    const suffix = SRC.slice(SRC.indexOf('## B notes'))
    expect(next.startsWith(prefix)).toBe(true)
    expect(next.endsWith(suffix)).toBe(true)
    expect(next).toContain('| x    | done  |')
    expect(next).not.toContain('| x    | open  |')
  })

  it('double-write invariant: stored HTML is rendered from the FULL new markdown', async () => {
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'replace',
      section: 'A queue',
      contentMarkdown: '## A queue\n\nemptied\n',
      // This replacement intentionally drops the section's table — the
      // structure guard (LUM-410) would 422 without the override.
      allowShrink: true,
    })

    const updateData = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
    expect(updateData.content).toBe(
      markdownToHtml(updateData.sourceMarkdown as string)
    )
    // The untouched section is present in both representations.
    expect(updateData.sourceMarkdown).toContain('## B notes')
    expect(updateData.content).toContain('B notes')
  })

  it('refuses when the doc has no stored markdown source (400, never the lossy render)', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc({ sourceMarkdown: null }))

    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'replace',
        section: 'A queue',
        contentMarkdown: 'x',
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(mockUpdateWithChildrenAndMentions).not.toHaveBeenCalled()
  })

  it('unknown section → 404 listing the available headings', async () => {
    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'replace',
        section: 'Z missing',
        contentMarkdown: 'x',
      })
    ).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('## A queue'),
    })
  })

  it('ambiguous section → 400 with depth-disambiguation hint', async () => {
    mockFindWithPermission.mockResolvedValue(
      ownerDoc({ sourceMarkdown: '# Dup\n\na\n\n## Dup\n\nb\n' })
    )
    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'replace',
        section: 'Dup',
        contentMarkdown: 'x',
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('ambiguous'),
    })
  })

  it('patch without a section is rejected (400)', async () => {
    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'replace',
        contentMarkdown: 'x',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('viewer role cannot section-edit (403)', async () => {
    mockFindWithPermission.mockResolvedValue(
      ownerDoc({
        createdById: 'someone-else',
        shares: [{ memberId: 'm-1', role: 'VIEWER' }],
      })
    )
    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'replace',
        section: 'A queue',
        contentMarkdown: 'x',
      })
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('section append (mode: append)', () => {
  it('appends at section end — every pre-existing byte preserved, insertion before the next heading', async () => {
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'append',
      section: 'A queue',
      contentMarkdown: '| y    | open  |',
    })

    const next = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
      .sourceMarkdown as string
    const insertAt = SRC.indexOf('## B notes')
    expect(next.startsWith(SRC.slice(0, insertAt))).toBe(true)
    expect(next.endsWith(SRC.slice(insertAt))).toBe(true)
    expect(next).toContain('| y    | open  |\n\n## B notes')
  })

  it('append without a section inserts at the document end', async () => {
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'append',
      contentMarkdown: '## C new\n\nfresh',
    })

    const next = mockUpdateWithChildrenAndMentions.mock.calls[0]![2]
      .sourceMarkdown as string
    expect(next.startsWith(SRC)).toBe(true)
    expect(next).toContain('## C new')
  })

  it('always commits conditionally on the revision the splice base was read at', async () => {
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'append',
      section: 'B notes',
      contentMarkdown: 'tail line',
    })

    const options = mockUpdateWithChildrenAndMentions.mock.calls[0]![5]
    expect(options).toEqual({ expectedContentRevision: 4 })
  })

  it('caller ifRevision wins as the precondition when provided', async () => {
    await documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
      mode: 'append',
      section: 'B notes',
      contentMarkdown: 'tail line',
      ifRevision: 4,
    })
    const options = mockUpdateWithChildrenAndMentions.mock.calls[0]![5]
    expect(options).toEqual({ expectedContentRevision: 4 })
  })

  it('stale ifRevision → 409 before anything is written', async () => {
    await expect(
      documentService.editDocumentSection('doc-1', 'm-1', 'ws-1', {
        mode: 'append',
        section: 'B notes',
        contentMarkdown: 'tail line',
        ifRevision: 3,
      })
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('current revision: 4'),
    })
    expect(mockUpdateWithChildrenAndMentions).not.toHaveBeenCalled()
  })
})
