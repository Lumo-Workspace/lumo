import { documentRepository } from '@/lib/repositories/document.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { document: { findFirst: jest.fn() } },
}))

describe('documentRepository.findByGoogleDocId', () => {
  it('queries by workspace + googleDocId', async () => {
    ;(prisma.document.findFirst as jest.Mock).mockResolvedValue({ id: 'doc1' })
    const row = await documentRepository.findByGoogleDocId('ws1', 'gdoc1')
    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws1', googleDocId: 'gdoc1' },
    })
    expect(row).toEqual({ id: 'doc1' })
  })
})
