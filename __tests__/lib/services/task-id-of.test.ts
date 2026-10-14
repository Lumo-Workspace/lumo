import { taskIdOf } from '@/lib/services/task-test-case.service'

describe('taskIdOf (LUM-1135)', () => {
  it('returns the task id of a task-owned case', () => {
    expect(taskIdOf({ taskId: 'task-1' })).toBe('task-1')
  })

  it('treats a milestone-owned case as not found', () => {
    expect(() => taskIdOf({ taskId: null })).toThrow(
      expect.objectContaining({ status: 404 })
    )
  })
})
