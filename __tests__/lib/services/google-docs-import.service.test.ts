jest.mock('@/lib/auth/users', () => ({ getUserDirectory: async () => ({}) }))
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))
jest.mock('@/lib/services/google-drive-integration.service')
jest.mock('@/lib/services/document.service')
jest.mock('@/lib/repositories/document.repository')

import { getClientForMember } from '@/lib/services/google-drive-integration.service'
import { documentService } from '@/lib/services/document.service'
import { documentRepository } from '@/lib/repositories/document.repository'
import { googleDocsImportService } from '@/lib/services/google-docs-import.service'

const fakeClient = {
  getMetadata: jest.fn(),
  exportMarkdown: jest.fn(),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getClientForMember as jest.Mock).mockResolvedValue(fakeClient)
})

describe('importGoogleDoc', () => {
  it('rejects an unparseable url', async () => {
    await expect(
      googleDocsImportService.importGoogleDoc('ws1', 'm1', {
        url: 'https://example.com',
      })
    ).rejects.toThrow(/not a valid google/i)
  })

  it('fetches metadata + markdown and creates a doc recording the importer', async () => {
    fakeClient.getMetadata.mockResolvedValue({
      id: 'gdoc123456',
      name: 'Spec',
      mimeType: 'application/vnd.google-apps.document',
    })
    fakeClient.exportMarkdown.mockResolvedValue('# Spec\n\nbody')
    ;(documentService.createDocument as jest.Mock).mockResolvedValue({
      id: 'doc1',
      slug: 'spec-1',
      title: 'Spec',
    })

    const out = await googleDocsImportService.importGoogleDoc('ws1', 'm1', {
      url: 'https://docs.google.com/document/d/gdoc123456/edit',
    })

    expect(documentService.createDocument).toHaveBeenCalledWith(
      'ws1',
      'm1',
      expect.objectContaining({
        title: 'Spec',
        contentMarkdown: '# Spec\n\nbody',
        googleDocId: 'gdoc123456',
        googleDocImporterId: 'm1',
      })
    )
    expect(out).toEqual({ id: 'doc1', slug: 'spec-1', title: 'Spec' })
  })
})

describe('resyncGoogleDoc', () => {
  it('throws 400 when the doc has no google source', async () => {
    ;(documentRepository.findSourceMeta as jest.Mock).mockResolvedValue({
      id: 'doc1',
      googleDocId: null,
      googleDocImporterId: null,
    })
    await expect(
      googleDocsImportService.resyncGoogleDoc('ws1', 'm1', 'doc1')
    ).rejects.toThrow(/not a google-imported/i)
  })

  it('re-syncs using the importer token and overwrites the body', async () => {
    ;(documentRepository.findSourceMeta as jest.Mock).mockResolvedValue({
      id: 'doc1',
      googleDocId: 'g1',
      googleDocImporterId: 'importer1',
    })
    fakeClient.exportMarkdown.mockResolvedValue('# Updated')
    ;(documentService.updateDocument as jest.Mock).mockResolvedValue({
      id: 'doc1',
    })

    await googleDocsImportService.resyncGoogleDoc('ws1', 'm1', 'doc1')

    // owner model: client built for the importer, not the acting member
    expect(getClientForMember).toHaveBeenCalledWith('ws1', 'importer1')
    expect(documentService.updateDocument).toHaveBeenCalledWith(
      'doc1',
      'importer1',
      'ws1',
      expect.objectContaining({ contentMarkdown: '# Updated' })
    )
  })
})
