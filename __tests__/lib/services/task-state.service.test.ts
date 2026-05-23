/**
 * @jest-environment node
 *
 * Tests for updateTask tag-branching logic in task-state.service.ts.
 * The mutex between tagIds and addTagIds/removeTagIds is enforced at the
 * schema layer; we verify that contract here via updateTaskSchema.safeParse.
 */

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    update: jest.fn(),
    findChildren: jest.fn().mockResolvedValue([]),
    findProjectIdById: jest.fn(),
    findActorById: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    syncTaskTags: jest.fn().mockResolvedValue(undefined),
    addTaskTags: jest.fn().mockResolvedValue(undefined),
    removeTaskTags: jest.fn().mockResolvedValue(undefined),
    findByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: () => true,
}))

import { tagRepository } from '@/lib/repositories/tag.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { updateTask } from '@/lib/services/task-state.service'
import { updateTaskSchema } from '@/lib/validation/schemas'

const syncTaskTags = tagRepository.syncTaskTags as jest.Mock
const addTaskTags = tagRepository.addTaskTags as jest.Mock
const removeTaskTags = tagRepository.removeTaskTags as jest.Mock

function mockTaskRow(overrides: Partial<{ status: string }> = {}) {
  return {
    id: 'task-1',
    title: 'T',
    status: overrides.status ?? 'TODO',
    projectId: 'proj-1',
    project: { workspaceId: 'ws-1' },
    team: { identifier: 'LUM' },
    sprintId: null,
    assigneeActorId: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue(mockTaskRow())
  ;(taskRepository.update as jest.Mock).mockImplementation(
    async (_id, data) => ({
      ...mockTaskRow(),
      ...data,
      team: { identifier: 'LUM' },
    })
  )
})

// ── updateTask tag branching tests ───────────────────────────────────────────

describe('updateTask — tag branching', () => {
  it('bulk replace via tagIds calls syncTaskTags', async () => {
    await updateTask('task-1', { tagIds: ['tag-b'] })

    expect(syncTaskTags).toHaveBeenCalledWith('task-1', ['tag-b'])
    expect(addTaskTags).not.toHaveBeenCalled()
    expect(removeTaskTags).not.toHaveBeenCalled()
  })

  it('addTagIds + removeTagIds applies add then remove (order matters)', async () => {
    await updateTask('task-1', {
      addTagIds: ['tag-c'],
      removeTagIds: ['tag-a'],
    })

    expect(syncTaskTags).not.toHaveBeenCalled()

    // Verify both were called
    expect(addTaskTags).toHaveBeenCalledWith('task-1', ['tag-c'])
    expect(removeTaskTags).toHaveBeenCalledWith('task-1', ['tag-a'])

    // Assert add came before remove
    const addOrder = (addTaskTags as jest.Mock).mock.invocationCallOrder[0]!
    const removeOrder = (removeTaskTags as jest.Mock).mock
      .invocationCallOrder[0]!
    expect(addOrder).toBeLessThan(removeOrder)
  })

  it('only addTagIds → only add called', async () => {
    await updateTask('task-1', { addTagIds: ['tag-c'] })

    expect(addTaskTags).toHaveBeenCalledWith('task-1', ['tag-c'])
    expect(removeTaskTags).not.toHaveBeenCalled()
    expect(syncTaskTags).not.toHaveBeenCalled()
  })

  it('only removeTagIds → only remove called', async () => {
    await updateTask('task-1', { removeTagIds: ['tag-a'] })

    expect(removeTaskTags).toHaveBeenCalledWith('task-1', ['tag-a'])
    expect(addTaskTags).not.toHaveBeenCalled()
    expect(syncTaskTags).not.toHaveBeenCalled()
  })

  it('no tag fields → no tag repo calls', async () => {
    await updateTask('task-1', { title: 'New Title' })

    expect(syncTaskTags).not.toHaveBeenCalled()
    expect(addTaskTags).not.toHaveBeenCalled()
    expect(removeTaskTags).not.toHaveBeenCalled()
  })
})

// ── updateTaskSchema mutex test ───────────────────────────────────────────────

describe('updateTaskSchema — tagIds mutex', () => {
  it('rejects tagIds + addTagIds at the schema layer', () => {
    const result = updateTaskSchema.safeParse({
      tagIds: [],
      addTagIds: ['clid0000000000000000000001'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/mutually exclusive/i)
    }
  })

  it('rejects tagIds + removeTagIds at the schema layer', () => {
    const result = updateTaskSchema.safeParse({
      tagIds: ['clid0000000000000000000001'],
      removeTagIds: ['clid0000000000000000000002'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/mutually exclusive/i)
    }
  })

  it('accepts tagIds alone', () => {
    const result = updateTaskSchema.safeParse({
      tagIds: ['clid0000000000000000000001'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts addTagIds + removeTagIds without tagIds', () => {
    const result = updateTaskSchema.safeParse({
      addTagIds: ['clid0000000000000000000001'],
      removeTagIds: ['clid0000000000000000000002'],
    })
    expect(result.success).toBe(true)
  })
})
