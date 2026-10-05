/**
 * @jest-environment node
 *
 * LUM-821 P1: due date through the CLI service path and the dueDate no-op fix
 * in changedFields. The parent-task half of LUM-821 was removed in LUM-959;
 * the CLI schemas now refuse `parentRef` from an older CLI.
 */
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
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
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.findForUpdate!.mockResolvedValue(BASE_TASK)
  repo.update!.mockImplementation(async (_id: string, data: object) => ({
    ...BASE_TASK,
    ...data,
    team: { identifier: 'LUM' },
  }))
})

describe('dueDate change detection', () => {
  it('re-saving the same instant is NOT a change (no phantom DUE_DATE_CHANGED)', async () => {
    const r = await updateTask('task-1', 'ws-1', {
      dueDate: '2026-09-29T16:00:00.000Z',
    })
    expect(r.changedFields).not.toContain('dueDate')
  })

  it('a different day, or clearing, is a change', async () => {
    const moved = await updateTask('task-1', 'ws-1', {
      dueDate: '2026-10-05T16:00:00.000Z',
    })
    expect(moved.changedFields).toContain('dueDate')
    const cleared = await updateTask('task-1', 'ws-1', { dueDate: null })
    expect(cleared.changedFields).toContain('dueDate')
  })
})

describe('CLI schemas', () => {
  it('create accepts a dueDate instant', () => {
    const r = cliCreateTaskSchema.safeParse({
      title: 't',
      dueDate: '2026-09-29T16:00:00.000Z',
    })
    expect(r.success && r.data).toMatchObject({
      dueDate: '2026-09-29T16:00:00.000Z',
    })
  })

  it('update accepts null to clear the due date, rejects a bare day', () => {
    expect(cliUpdateTaskSchema.safeParse({ dueDate: null }).success).toBe(true)
    expect(
      cliUpdateTaskSchema.safeParse({ dueDate: '2026-09-30' }).success
    ).toBe(false)
  })
})

describe('LUM-959: --parent from an older CLI is refused, not dropped', () => {
  const removed = /Subtasks were removed \(LUM-959\)/

  it('create rejects parentRef with the removal message', () => {
    const r = cliCreateTaskSchema.safeParse({ title: 't', parentRef: 'LUM-42' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toMatch(removed)
  })

  it('update rejects parentRef, including the old "" → null detach', () => {
    for (const parentRef of ['LUM-42', null]) {
      const r = cliUpdateTaskSchema.safeParse({ parentRef })
      expect(r.success).toBe(false)
      expect(r.error?.issues[0]?.message).toMatch(removed)
    }
  })
})
