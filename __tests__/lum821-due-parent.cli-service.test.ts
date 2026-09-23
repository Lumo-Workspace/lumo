/**
 * @jest-environment node
 *
 * LUM-821 P1: taskCliService resolves `parentRef` (LUM-N) to an id in the
 * workspace, forwards dueDate, and `showFromCli` returns due / parent /
 * subtasks.
 */
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspaceAndClerkId: jest.fn(),
    findActorByMemberId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services/session-binding-guard', () => ({
  enforceSessionBinding: jest.fn().mockResolvedValue({ advisory: null }),
}))
jest.mock('@/lib/services/auth.service', () => ({
  authService: { fetchUserProfile: jest.fn() },
}))

import { taskService } from '@/lib/services/task.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskCliService } from '@/lib/services/task-cli.service'

const svc = taskService as unknown as Record<string, jest.Mock>
const mem = memberRepository as unknown as Record<string, jest.Mock>

beforeEach(() => {
  jest.clearAllMocks()
  svc.resolveIdentifier!.mockImplementation(async (_ws: string, ref: string) =>
    ref === 'LUM-48'
      ? { id: 'task_48', identifier: 'LUM-48' }
      : ref === 'LUM-10'
        ? { id: 'task_10', identifier: 'LUM-10' }
        : null
  )
  svc.getTaskDetail!.mockResolvedValue({
    id: 'task_48',
    title: 'Child',
    status: 'TODO',
    priority: 'LOW',
    description: null,
    sprintId: null,
    teamId: 'team_1',
    projectId: 'proj_1',
    project: { id: 'proj_1', name: 'lumo', workspaceId: 'ws_1' },
    assignee: null,
    pullRequests: [],
    dueDate: new Date('2026-09-29T16:00:00.000Z'),
    parent: { id: 'task_10', title: 'Epic', number: 10, teamIdentifier: 'LUM' },
    children: [{ id: 'c1', title: 'Leaf', number: 50, status: 'IN_PROGRESS' }],
  })
  mem.findByWorkspaceAndClerkId!.mockResolvedValue({ id: 'mem_1' })
  mem.findActorByMemberId!.mockResolvedValue({ id: 'actor_1' })
  svc.updateTaskWithSideEffects!.mockResolvedValue({
    task: {
      id: 'task_48',
      title: 'Child',
      teamIdentifier: 'LUM',
      number: 48,
      tags: [],
      status: 'TODO',
    },
  })
})

const update = (input: Record<string, unknown>) =>
  taskCliService.updateFromCli({
    workspaceId: 'ws_1',
    workspaceSlug: 'ws',
    callerClerkId: 'clerk_1',
    identifier: 'LUM-48',
    input,
  })

describe('updateFromCli — due / parent', () => {
  it('resolves parentRef to the parent id and forwards dueDate', async () => {
    await update({ parentRef: 'LUM-10', dueDate: '2026-09-29T16:00:00.000Z' })
    expect(svc.updateTaskWithSideEffects!.mock.calls[0][1]).toMatchObject({
      parentTaskId: 'task_10',
      dueDate: '2026-09-29T16:00:00.000Z',
    })
  })

  it('null clears both', async () => {
    await update({ parentRef: null, dueDate: null })
    expect(svc.updateTaskWithSideEffects!.mock.calls[0][1]).toMatchObject({
      parentTaskId: null,
      dueDate: null,
    })
  })

  it('an unknown parent is a 404 and nothing is written', async () => {
    await expect(update({ parentRef: 'LUM-404' })).rejects.toMatchObject({
      status: 404,
    })
    expect(svc.updateTaskWithSideEffects).not.toHaveBeenCalled()
  })
})

describe('showFromCli — due / parent / subtasks', () => {
  it('returns the due instant, parent and subtasks', async () => {
    const r = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(r.dueDate).toBe('2026-09-29T16:00:00.000Z')
    expect(r.parent).toEqual({ identifier: 'LUM-10', title: 'Epic' })
    expect(r.subtasks).toEqual([
      { identifier: 'LUM-50', title: 'Leaf', status: 'IN_PROGRESS' },
    ])
  })
})
