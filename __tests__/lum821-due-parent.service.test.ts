/**
 * @jest-environment node
 *
 * LUM-821 P1: due date + parent task through the CLI service path, the
 * shared parent rules (self / cross-project / cycle) in updateTask, and the
 * dueDate no-op fix in changedFields.
 */
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    findProjectIdById: jest.fn(),
    findChildren: jest.fn(),
    update: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn().mockResolvedValue([]),
    syncTaskTags: jest.fn(),
  },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
  },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { updateTask } from '@/lib/services/task-state.service'
import {
  cliCreateTaskSchema,
  cliUpdateTaskSchema,
} from '@/lib/validation/schemas'

const repo = taskRepository as unknown as Record<string, jest.Mock>

const BASE_TASK = {
  id: 'task-1',
  status: 'TODO',
  projectId: 'proj-1',
  project: { workspaceId: 'ws-1' },
  assigneeActorId: null,
  dueDate: new Date('2026-09-29T16:00:00.000Z'),
  parentTaskId: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.findForUpdate!.mockResolvedValue(BASE_TASK)
  repo.findChildren!.mockResolvedValue([])
  repo.update!.mockImplementation(async (_id: string, data: object) => ({
    ...BASE_TASK,
    ...data,
    team: { identifier: 'LUM' },
  }))
})

describe('parent rules shared by web and CLI (updateTask)', () => {
  it('rejects a parent in another project', async () => {
    repo.findProjectIdById!.mockResolvedValue({ projectId: 'proj-OTHER' })
    await expect(
      updateTask('task-1', { parentTaskId: 'task-9' })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Parent task not found in this project',
    })
  })

  it('rejects a cycle (the new parent is a descendant)', async () => {
    repo.findProjectIdById!.mockResolvedValue({ projectId: 'proj-1' })
    repo.findChildren!.mockImplementation(async (id: string) =>
      id === 'task-1' ? [{ id: 'task-2' }] : []
    )
    await expect(
      updateTask('task-1', { parentTaskId: 'task-2' })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Cannot create circular parent reference',
    })
  })

  it('accepts a valid same-project parent and records the change', async () => {
    repo.findProjectIdById!.mockResolvedValue({ projectId: 'proj-1' })
    const r = await updateTask('task-1', { parentTaskId: 'task-3' })
    expect(repo.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ parentTaskId: 'task-3' })
    )
    expect(r.changedFields).toContain('parentTaskId')
  })
})

describe('dueDate change detection', () => {
  it('re-saving the same instant is NOT a change (no phantom DUE_DATE_CHANGED)', async () => {
    const r = await updateTask('task-1', {
      dueDate: '2026-09-29T16:00:00.000Z',
    })
    expect(r.changedFields).not.toContain('dueDate')
  })

  it('a different day, or clearing, is a change', async () => {
    const moved = await updateTask('task-1', {
      dueDate: '2026-10-05T16:00:00.000Z',
    })
    expect(moved.changedFields).toContain('dueDate')
    const cleared = await updateTask('task-1', { dueDate: null })
    expect(cleared.changedFields).toContain('dueDate')
  })
})

describe('CLI schemas', () => {
  it('create accepts dueDate instant + parentRef', () => {
    const r = cliCreateTaskSchema.safeParse({
      title: 't',
      dueDate: '2026-09-29T16:00:00.000Z',
      parentRef: 'LUM-42',
    })
    expect(r.success && r.data).toMatchObject({
      dueDate: '2026-09-29T16:00:00.000Z',
      parentRef: 'LUM-42',
    })
  })
  it('update accepts null to clear both, rejects a bare day', () => {
    expect(
      cliUpdateTaskSchema.safeParse({ dueDate: null, parentRef: null }).success
    ).toBe(true)
    expect(
      cliUpdateTaskSchema.safeParse({ dueDate: '2026-09-30' }).success
    ).toBe(false)
  })
})
