/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { hookEvent: { findFirst: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const mockFindFirst = prisma.hookEvent.findFirst as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('hookEventRepository.hasToolUseForTask', () => {
  it('matches PRE_TOOL_USE events by the same task attribution as findByTaskId', async () => {
    mockFindFirst.mockResolvedValue({ id: 'e1' })

    const result = await hookEventRepository.hasToolUseForTask('task-1')

    expect(result).toBe(true)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        type: 'PRE_TOOL_USE',
        OR: [{ taskId: 'task-1' }, { taskId: null, session: { taskId: 'task-1' } }],
      },
      select: { id: true },
    })
  })

  it('returns false when no tool-use event exists for the task', async () => {
    mockFindFirst.mockResolvedValue(null)

    const result = await hookEventRepository.hasToolUseForTask('task-1')

    expect(result).toBe(false)
  })
})
