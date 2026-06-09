// __tests__/memory.repository.supersede.test.ts
import { memoryRepository } from '@/lib/repositories/memory.repository'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { memory: { update: jest.fn().mockResolvedValue({ id: 'mem_1' }) } },
}))
import { prisma } from '@/lib/db/prisma'

describe('memoryRepository.supersedeInPlace', () => {
  it('overwrites content on the existing row, preserving its id (LUM-325 swap seam)', async () => {
    await memoryRepository.supersedeInPlace('mem_1', { rule: 'new', scope: 'all' })
    expect(prisma.memory.update).toHaveBeenCalledWith({
      where: { id: 'mem_1' },
      data: { content: { rule: 'new', scope: 'all' } },
      select: { id: true },
    })
  })
})
