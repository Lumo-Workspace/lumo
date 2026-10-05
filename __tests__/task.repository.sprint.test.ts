import { taskRepository } from '@/lib/repositories/task.repository'

const mockUpdate = jest.fn()
const mockUpdateMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      update: (...a: any[]) => mockUpdate(...a),
      updateMany: (...a: any[]) => mockUpdateMany(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.updateSprint', () => {
  it('updates single task.sprintId', async () => {
    mockUpdate.mockResolvedValueOnce({ id: 't1', sprintId: 's1' })
    await taskRepository.updateSprint('t1', 'w1', 's1')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 't1', workspaceId: 'w1' },
      data: { sprintId: 's1' },
    })
  })

  it('accepts null to clear sprint', async () => {
    mockUpdate.mockResolvedValueOnce({ id: 't1', sprintId: null })
    await taskRepository.updateSprint('t1', 'w1', null)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 't1', workspaceId: 'w1' },
      data: { sprintId: null },
    })
  })
})

describe('taskRepository.bulkUpdateSprint', () => {
  it('updateMany on ids', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 3 })
    await taskRepository.bulkUpdateSprint(['t1', 't2', 't3'], 's1')
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t1', 't2', 't3'] } },
      data: { sprintId: 's1' },
    })
  })
})
