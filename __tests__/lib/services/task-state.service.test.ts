/**
 * @jest-environment node
 *
 * Tests for updateTask tag-branching logic in task-state.service.ts.
 * The mutex between tagIds and addTagIds/removeTagIds is enforced at the
 * schema layer; we verify that contract here via updateTaskSchema.safeParse.
 */

jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>${md}</p>`) },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    update: jest.fn(),
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

import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { updateTask } from '@/lib/services/task-state.service'
import { updateTaskSchema } from '@/lib/validation/schemas'

const syncTaskTags = tagRepository.syncTaskTags as jest.Mock
const addTaskTags = tagRepository.addTaskTags as jest.Mock
const removeTaskTags = tagRepository.removeTaskTags as jest.Mock
const findByTask = tagRepository.findByTask as jest.Mock

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
  it('bulk replace via tagIds calls syncTaskTags and fetches tags', async () => {
    await updateTask('task-1', 'ws-1', { tagIds: ['tag-b'] })

    expect(syncTaskTags).toHaveBeenCalledWith('task-1', ['tag-b'])
    expect(addTaskTags).not.toHaveBeenCalled()
    expect(removeTaskTags).not.toHaveBeenCalled()
    expect(findByTask).toHaveBeenCalledWith('task-1')
  })

  it('addTagIds + removeTagIds applies add then remove (order matters)', async () => {
    await updateTask('task-1', 'ws-1', {
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

    // tags were touched, so findByTask must have been called
    expect(findByTask).toHaveBeenCalledWith('task-1')
  })

  it('only addTagIds → only add called, findByTask called', async () => {
    await updateTask('task-1', 'ws-1', { addTagIds: ['tag-c'] })

    expect(addTaskTags).toHaveBeenCalledWith('task-1', ['tag-c'])
    expect(removeTaskTags).not.toHaveBeenCalled()
    expect(syncTaskTags).not.toHaveBeenCalled()
    expect(findByTask).toHaveBeenCalledWith('task-1')
  })

  it('only removeTagIds → only remove called, findByTask called', async () => {
    await updateTask('task-1', 'ws-1', { removeTagIds: ['tag-a'] })

    expect(removeTaskTags).toHaveBeenCalledWith('task-1', ['tag-a'])
    expect(addTaskTags).not.toHaveBeenCalled()
    expect(syncTaskTags).not.toHaveBeenCalled()
    expect(findByTask).toHaveBeenCalledWith('task-1')
  })

  it('no tag fields → no tag repo calls and findByTask NOT called', async () => {
    await updateTask('task-1', 'ws-1', { title: 'New Title' })

    expect(syncTaskTags).not.toHaveBeenCalled()
    expect(addTaskTags).not.toHaveBeenCalled()
    expect(removeTaskTags).not.toHaveBeenCalled()
    expect(findByTask).not.toHaveBeenCalled()
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

describe('updateTask — description normalization', () => {
  it('converts markdown description to HTML before update', async () => {
    await updateTask('task-1', 'ws-1', { description: '## H' })
    const data = (taskRepository.update as jest.Mock).mock.calls[0][2]
    expect(data.description).toBe('<p>## H</p>')
  })

  it('clears description when set to empty string', async () => {
    await updateTask('task-1', 'ws-1', { description: '' })
    const data = (taskRepository.update as jest.Mock).mock.calls[0][2]
    expect(data.description).toBeNull()
  })

  it('passes through HTML descriptions unchanged', async () => {
    const html = '<p>already html</p>'
    await updateTask('task-1', 'ws-1', { description: html })
    const data = (taskRepository.update as jest.Mock).mock.calls[0][2]
    expect(data.description).toBe(html)
  })

  it('does not touch description when undefined (no description in input)', async () => {
    await updateTask('task-1', 'ws-1', { title: 'new title' })
    const data = (taskRepository.update as jest.Mock).mock.calls[0][2]
    expect(data.description).toBeUndefined()
  })
})

describe('updateTask — archived milestone bind guard', () => {
  it('rejects binding a task to an archived milestone with 409', async () => {
    ;(milestoneRepository.findById as jest.Mock).mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      archivedAt: new Date(),
    })
    await expect(
      updateTask('task-1', 'ws-1', { milestoneId: 'm1' })
    ).rejects.toMatchObject({ status: 409 })
  })
})
