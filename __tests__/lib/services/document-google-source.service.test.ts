import { documentRepository } from '@/lib/repositories/document.repository'

jest.mock('@/lib/repositories/document.repository')
jest.mock('@/lib/repositories/tag.repository', () => ({ tagRepository: {} }))
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: { getUserList: async () => ({ data: [] }) },
  }),
}))
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { documentService } from '@/lib/services/document.service'

describe('createDocument with google source', () => {
  it('forwards googleDocId / importer / syncedAt to the repository', async () => {
    const repo = documentRepository as jest.Mocked<typeof documentRepository>
    repo.getMaxSortOrder.mockResolvedValue(0)
    repo.create.mockResolvedValue({
      id: 'doc1',
      createdBy: { id: 'm1', clerkId: 'ck1' },
    } as never)
    repo.updateWithChildrenAndMentions.mockResolvedValue({} as never)

    const syncedAt = new Date('2026-05-31T00:00:00Z')
    await documentService.createDocument('ws1', 'm1', {
      title: 'Imported',
      visibility: 'PRIVATE',
      contentMarkdown: '# hi',
      googleDocId: 'gdoc1',
      googleDocImporterId: 'm1',
      googleDocSyncedAt: syncedAt,
    })

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        googleDocId: 'gdoc1',
        googleDocImporterId: 'm1',
        googleDocSyncedAt: syncedAt,
      })
    )
  })
})
