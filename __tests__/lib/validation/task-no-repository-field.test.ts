import {
  createTaskSchema,
  updateTaskSchema,
  taskDraftDataSchema,
} from '@/lib/validation/schemas'

/**
 * LUM-400: Task.repositoryId was removed end-to-end. Old clients (or stale
 * localStorage drafts) may still send the key in their JSON bodies — the Zod
 * schemas must strip it silently so it can never reach the service layer or
 * Prisma (where the column no longer exists).
 */
describe('task schemas no longer carry repositoryId', () => {
  it('createTaskSchema strips a stray repositoryId key', () => {
    const result = createTaskSchema.safeParse({
      title: 'A task',
      repositoryId: 'repo_123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('repositoryId')
    }
  })

  it('updateTaskSchema strips a stray repositoryId key', () => {
    const result = updateTaskSchema.safeParse({
      title: 'Renamed',
      repositoryId: 'repo_123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('repositoryId')
    }
  })

  it('taskDraftDataSchema strips repositoryId from legacy drafts', () => {
    const result = taskDraftDataSchema.safeParse({
      title: 'Old draft',
      repositoryId: 'repo_789',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('repositoryId')
    }
  })
})
