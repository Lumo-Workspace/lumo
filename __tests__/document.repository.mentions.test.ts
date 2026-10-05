import { documentRepository } from '@/lib/repositories/document.repository'

const mockPrismaMentionCreateMany = jest.fn()
const mockPrismaDocUpdate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    documentMention: {
      createMany: (...args: any[]) => mockPrismaMentionCreateMany(...args),
    },
    document: {
      update: (...args: any[]) => mockPrismaDocUpdate(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

function fakeTx() {
  return {
    documentMention: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    document: { update: jest.fn().mockResolvedValue({ id: 'd-1' }) },
  }
}

describe('documentRepository.createMentions', () => {
  it('batch-inserts mentions on the given transaction client, skipping duplicates', async () => {
    const tx = fakeTx()
    const rows = [
      { documentId: 'd-1', taskId: 't-1', source: 'EXPLICIT' as const },
      { documentId: 'd-1', taskId: 't-2', source: 'EXPLICIT' as const },
    ]

    await documentRepository.createMentions(rows, tx as any)

    expect(tx.documentMention.createMany).toHaveBeenCalledWith({
      data: rows,
      skipDuplicates: true,
    })
    expect(mockPrismaMentionCreateMany).not.toHaveBeenCalled()
  })

  it('short-circuits on an empty list without touching the database', async () => {
    const tx = fakeTx()

    const result = await documentRepository.createMentions([], tx as any)

    expect(result).toEqual({ count: 0 })
    expect(tx.documentMention.createMany).not.toHaveBeenCalled()
  })

  it('falls back to the prisma client when no transaction is given', async () => {
    await documentRepository.createMentions([
      { documentId: 'd-1', taskId: 't-1', source: 'EXPLICIT' as const },
    ])

    expect(mockPrismaMentionCreateMany).toHaveBeenCalledTimes(1)
  })
})

describe('documentRepository.updateContent', () => {
  it('updates only the content field on the given transaction client', async () => {
    const tx = fakeTx()

    await documentRepository.updateContent(
      'd-1',
      'ws-1',
      '<p>hi</p>',
      tx as any
    )

    expect(tx.document.update).toHaveBeenCalledWith({
      where: { id: 'd-1', workspaceId: 'ws-1' },
      data: { content: '<p>hi</p>' },
    })
    expect(mockPrismaDocUpdate).not.toHaveBeenCalled()
  })

  it('falls back to the prisma client when no transaction is given', async () => {
    await documentRepository.updateContent('d-1', 'ws-1', '<p>hi</p>')

    expect(mockPrismaDocUpdate).toHaveBeenCalledWith({
      where: { id: 'd-1', workspaceId: 'ws-1' },
      data: { content: '<p>hi</p>' },
    })
  })
})
