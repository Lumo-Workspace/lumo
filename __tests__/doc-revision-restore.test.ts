/**
 * @jest-environment node
 *
 * LUM-445 — revision restore must not lock the markdown write path.
 *
 * Incident (2606d ledger): an agent appended rev11→15 successfully; a single
 * web revision-restore reverted the appends AND nulled `Document.sourceMarkdown`
 * — permanently locking every markdown write path (raw/append/section/diff) for
 * all agents, recoverable only by a lossy rebuild (LUM-349).
 *
 * Two storage-level invariants pinned here, driven end-to-end through the real
 * `documentRevisionService.restoreRevision` → real `documentService.updateDocument`
 * → real `snapshotOnSave`, against an in-memory revision store:
 *
 *   1. Restoring a markdown-authored revision re-establishes the byte-identical
 *      source on the document (post-restore --raw/append succeed; no invalidate).
 *   2. Restore is additive: it stacks a NEW revision on top, the prior forward
 *      revisions stay in history and remain restore-forward-able (never pruned),
 *      and the stacked revision carries the restored source.
 */
import { documentRevisionService } from '@/lib/services/documentRevision.service'
import { markdownToHtml } from '@/lib/utils/markdown-tiptap'

// ── In-memory revision store (the production additive/no-prune behaviour lives
//    in real restoreRevision + real snapshotOnSave; only the DB is faked) ──────

type FakeRev = {
  id: string
  documentId: string
  workspaceId: string
  authorId: string
  content: string | null
  sourceMarkdown: string | null
  title: string
  emoji: string | null
  label: string | null
  isManual: boolean
  wordCount: number | null
  createdAt: Date
  updatedAt: Date
}

const mockRevStore: FakeRev[] = []
let mockRevSeq = 0
const mockDeleteByIds = jest.fn(async (ids: string[]) => {
  let count = 0
  for (const id of ids) {
    const i = mockRevStore.findIndex(r => r.id === id)
    if (i !== -1) {
      mockRevStore.splice(i, 1)
      count += 1
    }
  }
  return { count }
})

function seedRevision(
  r: Partial<FakeRev> & { id: string; documentId: string }
) {
  mockRevSeq += 1
  mockRevStore.push({
    workspaceId: 'ws-1',
    authorId: 'owner',
    content: null,
    sourceMarkdown: null,
    title: 'T',
    emoji: null,
    label: null,
    isManual: false,
    wordCount: null,
    // Strictly increasing so push-order == createdAt-order (latest = last).
    createdAt: new Date(2026, 0, 1, 0, 0, mockRevSeq),
    updatedAt: new Date(2026, 0, 1, 0, 0, mockRevSeq),
    ...r,
  })
}

jest.mock('@/lib/repositories/documentRevision.repository', () => ({
  documentRevisionRepository: {
    create: jest.fn(async (d: any) => {
      mockRevSeq += 1
      const now = new Date(2026, 0, 1, 0, 0, mockRevSeq)
      const row: FakeRev = {
        id: `auto-${mockRevSeq}`,
        documentId: d.documentId,
        workspaceId: d.workspaceId,
        authorId: d.authorId,
        content: d.content ?? null,
        sourceMarkdown: d.sourceMarkdown ?? null,
        title: d.title ?? '',
        emoji: d.emoji ?? null,
        label: d.label ?? null,
        isManual: d.isManual ?? false,
        wordCount: d.wordCount ?? null,
        createdAt: now,
        updatedAt: now,
      }
      mockRevStore.push(row)
      return row
    }),
    findLatestForDocument: jest.fn(async (documentId: string) => {
      const rows = mockRevStore.filter(r => r.documentId === documentId)
      return rows.length ? rows[rows.length - 1] : null
    }),
    findByIdWithContent: jest.fn(
      async (id: string, documentId: string) =>
        mockRevStore.find(r => r.id === id && r.documentId === documentId) ??
        null
    ),
    updateContent: jest.fn(async (id: string, d: any) => {
      const r = mockRevStore.find(x => x.id === id)!
      r.content = d.content
      r.sourceMarkdown = d.sourceMarkdown ?? r.sourceMarkdown
      r.title = d.title
      r.emoji = d.emoji ?? null
      r.wordCount = d.wordCount ?? null
      r.updatedAt = new Date(2026, 0, 1, 1, 0, 0)
      return r
    }),
    listByDocument: jest.fn(async (documentId: string) =>
      mockRevStore.filter(r => r.documentId === documentId)
    ),
    deleteByIds: (...a: [string[]]) => mockDeleteByIds(...a),
  },
}))

// ── Mutable document the restore writes back into ───────────────────────────

const mockDocRef: { current: any } = { current: null }
const mockUpdateCalls: any[] = []

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: jest.fn(async () => mockDocRef.current),
    findById: jest.fn(async () => mockDocRef.current),
    updateWithChildrenAndMentions: jest.fn(
      async (_docId: string, _workspaceId: string, updateData: any) => {
        mockUpdateCalls.push(updateData)
        Object.assign(mockDocRef.current, updateData)
        mockDocRef.current.contentRevision += 1
        return { ...mockDocRef.current, slug: 'ledger-7' }
      }
    ),
    upsertEditor: jest.fn(async () => undefined),
    updateSummary: jest.fn(async () => undefined),
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

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: jest.fn(),
    findByIdForMention: jest.fn(),
  },
}))

// Run waitUntil background work synchronously so the snapshot capture is
// observable within the test; the mention/summary blocks are self-catching.
jest.mock('@vercel/functions', () => ({ waitUntil: (p: any) => p }))

// Neutralise the body-write side effects (mention notify + summary) so they
// never reach prisma — restore's storage behaviour is what's under test.
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findNameAndSlug: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/lib/actor', () => ({
  getActorClerkId: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/services/content-summary.service', () => ({
  contentSummaryService: { summarize: jest.fn().mockResolvedValue('') },
}))
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: { getUserList: jest.fn().mockResolvedValue({ data: [] }) },
  }),
}))

// A table is the LUM-349 incident shape: it survives markdown→HTML rendering
// but NOT the HTML→markdown reverse render, so it is exactly what the
// byte-identical source column has to preserve across a restore.
const MARKDOWN_SOURCE = [
  '# Ledger',
  '',
  '| entry | status |',
  '| ----- | ------ |',
  '| 2606d | append |',
  '',
  'trailing spaces  ',
].join('\n')

beforeEach(() => {
  jest.clearAllMocks()
  mockRevStore.length = 0
  mockRevSeq = 0
  mockUpdateCalls.length = 0
  mockDocRef.current = {
    id: 'doc-1',
    number: 7,
    title: 'Ledger',
    emoji: null,
    content: '<p>current web edit</p>',
    sourceMarkdown: null, // already-invalidated: the incident's locked state
    contentRevision: 5,
    createdById: 'owner',
    shares: [],
  }
})

describe('LUM-445 revision restore — markdown source preservation', () => {
  it('restoring a markdown-authored revision keeps sourceMarkdown valid', async () => {
    // A revision that was authored from markdown carries its byte-identical
    // source alongside the rendered HTML snapshot.
    seedRevision({
      id: 'rev-md',
      documentId: 'doc-1',
      content: markdownToHtml(MARKDOWN_SOURCE),
      sourceMarkdown: MARKDOWN_SOURCE,
    })

    await documentRevisionService.restoreRevision(
      'doc-1',
      'rev-md',
      'owner',
      'ws-1'
    )

    // The document's source is re-established (NOT nulled): `doc show --raw`
    // and `doc append` read Document.sourceMarkdown, so a non-null byte-faithful
    // value is exactly "post-restore raw/append succeed".
    expect(mockDocRef.current.sourceMarkdown).toBe(MARKDOWN_SOURCE)
    expect(mockDocRef.current.content).toBe(markdownToHtml(MARKDOWN_SOURCE))

    // And the write that did it carried the source through, not a null.
    const lastWrite = mockUpdateCalls[mockUpdateCalls.length - 1]
    expect(lastWrite.sourceMarkdown).toBe(MARKDOWN_SOURCE)
  })

  it('revision restore is additive and does not prune forward history', async () => {
    // Forward history r1..r5 (the 2606d "11..15"); r5 is the live content.
    for (let n = 1; n <= 5; n++) {
      seedRevision({
        id: `r${n}`,
        documentId: 'doc-1',
        content: `<p>C${n}</p>`,
        sourceMarkdown: `# v${n}`,
      })
    }
    mockDocRef.current.content = '<p>C5</p>'
    const forwardIds = ['r2', 'r3', 'r4', 'r5']

    // Restore back to r1.
    await documentRevisionService.restoreRevision(
      'doc-1',
      'r1',
      'owner',
      'ws-1'
    )

    // Nothing pruned: every forward revision is still in history.
    for (const id of forwardIds) {
      expect(mockRevStore.some(r => r.id === id)).toBe(true)
    }
    expect(mockDeleteByIds).not.toHaveBeenCalled()

    // Additive: a brand-new revision is stacked on top (not an in-place rewrite
    // of any existing one) and it carries r1's restored source.
    expect(mockRevStore.length).toBe(6)
    const top = mockRevStore[mockRevStore.length - 1]!
    expect(top.content).toBe('<p>C1</p>')
    expect(top.sourceMarkdown).toBe('# v1')
    expect(forwardIds).not.toContain(top.id)

    // A forward revision (r5) is still restore-forward-able after the rollback.
    await documentRevisionService.restoreRevision(
      'doc-1',
      'r5',
      'owner',
      'ws-1'
    )
    expect(mockDeleteByIds).not.toHaveBeenCalled()
    expect(mockRevStore.length).toBe(7)
    expect(mockRevStore[mockRevStore.length - 1]!.content).toBe('<p>C5</p>')
  })
})
