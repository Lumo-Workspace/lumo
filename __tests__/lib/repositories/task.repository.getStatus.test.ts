/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { task: { findUnique: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'

const mockFindUnique = prisma.task.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.getStatus', () => {
  it('returns the task status, selecting only the status column', async () => {
    mockFindUnique.mockResolvedValue({ status: 'DONE' })
    const status = await taskRepository.getStatus('t-1')
    expect(status).toBe('DONE')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 't-1' },
      select: { status: true },
    })
  })

  it('returns null when the task does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await taskRepository.getStatus('missing')).toBeNull()
  })
})
