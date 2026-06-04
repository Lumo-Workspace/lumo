import { documentTemplateRepository } from '@/lib/repositories/document-template.repository'

const mockFindMany = jest.fn()
const mockFindUnique = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    documentTemplate: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}))

beforeEach(() => {
  mockFindMany.mockReset()
  mockFindUnique.mockReset()
})

describe('documentTemplateRepository.listVisible', () => {
  it('queries system templates OR templates owned by the workspace, ordered by sortOrder', async () => {
    mockFindMany.mockResolvedValue([])
    await documentTemplateRepository.listVisible('ws_1')

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { OR: [{ workspaceId: null }, { workspaceId: 'ws_1' }] },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        emoji: true,
        content: true,
        sortOrder: true,
      },
    })
  })
})

describe('documentTemplateRepository.findById', () => {
  it('looks up a single template by id', async () => {
    mockFindUnique.mockResolvedValue({ id: 't_1' })
    const result = await documentTemplateRepository.findById('t_1')

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 't_1' } })
    expect(result).toEqual({ id: 't_1' })
  })
})
