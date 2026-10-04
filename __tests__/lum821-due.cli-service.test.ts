/**
 * @jest-environment node
 *
 * LUM-821 P1: taskCliService forwards dueDate and `showFromCli` returns the
 * due instant. Since LUM-959 there are no parent / subtask fields.
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

describe('updateFromCli — due', () => {
  it('forwards dueDate', async () => {
    await update({ dueDate: '2026-09-29T16:00:00.000Z' })
    expect(svc.updateTaskWithSideEffects!.mock.calls[0][1]).toMatchObject({
      dueDate: '2026-09-29T16:00:00.000Z',
    })
  })

  it('null clears the due date', async () => {
    await update({ dueDate: null })
    expect(svc.updateTaskWithSideEffects!.mock.calls[0][1]).toMatchObject({
      dueDate: null,
    })
  })
})

describe('showFromCli — due', () => {
  it('returns the due instant and no parent / subtask fields', async () => {
    const r = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(r.dueDate).toBe('2026-09-29T16:00:00.000Z')
    expect(r).not.toHaveProperty('parent')
    expect(r).not.toHaveProperty('subtasks')
  })
})

describe('showFromCli — linked PR head sha (LUM-825)', () => {
  it('passes each PR headSha through, null when never synced', async () => {
    svc.getTaskDetail!.mockResolvedValueOnce({
      ...(await svc.getTaskDetail!()),
      pullRequests: [
        {
          number: 1,
          title: 'a',
          url: 'u1',
          state: 'merged',
          headSha: 'abc123',
        },
        { number: 2, title: 'b', url: 'u2', state: 'open', headSha: null },
      ],
    })
    const r = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(r.pullRequests).toEqual([
      { number: 1, title: 'a', url: 'u1', state: 'merged', headSha: 'abc123' },
      { number: 2, title: 'b', url: 'u2', state: 'open', headSha: null },
    ])
  })
})
