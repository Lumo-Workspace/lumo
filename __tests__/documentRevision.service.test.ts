import { documentRevisionService } from '@/lib/services/documentRevision.service'

const repo = {
  create: jest.fn(),
  findLatestForDocument: jest.fn(),
  updateContent: jest.fn(),
  listByDocument: jest.fn(),
  findByIdWithContent: jest.fn(),
  listForPrune: jest.fn(),
  listDocumentIdsWithRevisions: jest.fn(),
  deleteByIds: jest.fn(),
}
jest.mock('@/lib/repositories/documentRevision.repository', () => ({
  documentRevisionRepository: {
    create: (...a: any[]) => repo.create(...a),
    findLatestForDocument: (...a: any[]) => repo.findLatestForDocument(...a),
    updateContent: (...a: any[]) => repo.updateContent(...a),
    listByDocument: (...a: any[]) => repo.listByDocument(...a),
    findByIdWithContent: (...a: any[]) => repo.findByIdWithContent(...a),
    listForPrune: (...a: any[]) => repo.listForPrune(...a),
    listDocumentIdsWithRevisions: (...a: any[]) =>
      repo.listDocumentIdsWithRevisions(...a),
    deleteByIds: (...a: any[]) => repo.deleteByIds(...a),
  },
}))

const docRepo = { findWithPermission: jest.fn() }
jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: (...a: any[]) => docRepo.findWithPermission(...a),
  },
}))

const updateDocument = jest.fn()
jest.mock('@/lib/services/document.service', () => ({
  documentService: {
    updateDocument: (...a: any[]) => updateDocument(...a),
    getUserRole: (doc: any, memberId: string) =>
      doc.createdById === memberId
        ? 'OWNER'
        : (doc.shares.find((s: any) => s.memberId === memberId)?.role ?? null),
  },
}))

jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn().mockResolvedValue({
    getUserList: jest.fn().mockResolvedValue({ data: [] }),
  }),
}))

beforeEach(() => jest.clearAllMocks())

const NOW = new Date('2026-06-05T12:00:00.000Z')

describe('snapshotOnSave', () => {
  const snap = {
    content: '<p>new</p>',
    sourceMarkdown: '# new',
    title: 'T',
    emoji: null,
  }

  it('creates a new revision when there is no prior revision', async () => {
    repo.findLatestForDocument.mockResolvedValue(null)
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    // The byte-identical markdown source travels with the snapshot (LUM-445).
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'd1',
        workspaceId: 'w1',
        authorId: 'm1',
        content: '<p>new</p>',
        sourceMarkdown: '# new',
      })
    )
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('stores a CJK-aware word count derived from the HTML body', async () => {
    repo.findLatestForDocument.mockResolvedValue(null)
    await documentRevisionService.snapshotOnSave(
      'd1',
      'w1',
      'm1',
      {
        content: '<p>one two three</p>',
        sourceMarkdown: null,
        title: 'T',
        emoji: null,
      },
      NOW
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ wordCount: 3 })
    )
  })

  it('merges into the latest revision for the same author within 10 min', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: false,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:55:00Z'),
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.updateContent).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        content: '<p>new</p>',
        sourceMarkdown: '# new',
      })
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('creates a new revision when the window has expired', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: false,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:40:00Z'),
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).toHaveBeenCalled()
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('creates a new revision when the author differs', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm2',
      isManual: false,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:58:00Z'),
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).toHaveBeenCalled()
  })

  it('never merges into a manual snapshot', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: true,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:58:00Z'),
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).toHaveBeenCalled()
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('forceNewRevision skips the merge window and always creates', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: false,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:58:00Z'), // within window
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW, {
      forceNewRevision: true,
    })
    expect(repo.create).toHaveBeenCalled()
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('skips entirely when content is identical to the latest revision', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: false,
      content: '<p>new</p>',
      updatedAt: new Date('2026-06-05T11:58:00Z'),
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.updateContent).not.toHaveBeenCalled()
  })
})

describe('restoreRevision', () => {
  it('rejects a viewer with 403', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      id: 'd1',
      createdById: 'owner',
      shares: [],
    })
    await expect(
      documentRevisionService.restoreRevision('d1', 'r1', 'viewer', 'w1')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('writes the old content back through updateDocument', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      id: 'd1',
      createdById: 'm1',
      shares: [],
    })
    repo.findByIdWithContent.mockResolvedValue({
      id: 'r1',
      content: '<p>old</p>',
      sourceMarkdown: '# old',
    })
    updateDocument.mockResolvedValue({ id: 'd1' })
    await documentRevisionService.restoreRevision('d1', 'r1', 'm1', 'w1')
    // The restored snapshot's markdown source rides along so the write
    // re-establishes it instead of nulling it (LUM-445).
    expect(updateDocument).toHaveBeenCalledWith(
      'd1',
      'm1',
      'w1',
      { content: '<p>old</p>' },
      { forceNewRevision: true, restoreSourceMarkdown: '# old' }
    )
  })

  it('404s when the revision does not belong to the document', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      id: 'd1',
      createdById: 'm1',
      shares: [],
    })
    repo.findByIdWithContent.mockResolvedValue(null)
    await expect(
      documentRevisionService.restoreRevision('d1', 'rX', 'm1', 'w1')
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('pruneRevisions', () => {
  it('deletes the prunable ids for each document', async () => {
    repo.listDocumentIdsWithRevisions.mockResolvedValue(['d1'])
    repo.listForPrune.mockResolvedValue([
      {
        id: 'oldest',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        isManual: false,
      },
      {
        id: 'mid',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        isManual: false,
      },
      {
        id: 'mid2',
        createdAt: new Date('2026-01-02T06:00:00Z'),
        isManual: false,
      },
    ])
    repo.deleteByIds.mockResolvedValue({ count: 1 })
    const res = await documentRevisionService.pruneRevisions(NOW)
    expect(repo.deleteByIds).toHaveBeenCalledWith(['mid'])
    expect(res.deleted).toBe(1)
  })
})

describe('createManualSnapshot', () => {
  it('snapshots current doc content with the given label as a manual revision', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      id: 'd1',
      createdById: 'm1',
      shares: [],
      content: '<p>cur</p>',
      sourceMarkdown: '# cur',
      title: 'Doc',
      emoji: '📄',
    })
    repo.create.mockResolvedValue({ id: 'r1' })
    await documentRevisionService.createManualSnapshot(
      'd1',
      'm1',
      'w1',
      'v1 review'
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'd1',
        isManual: true,
        label: 'v1 review',
        content: '<p>cur</p>',
        sourceMarkdown: '# cur',
        title: 'Doc',
        emoji: '📄',
      })
    )
  })
})
