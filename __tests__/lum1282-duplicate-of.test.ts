/**
 * @jest-environment node
 *
 * LUM-1282: `--duplicate-of` on the server. updateFromCli resolves the
 * canonical task before any write (a missing target or a self-reference is a
 * 400, and nothing is updated), then records a DUPLICATES edge after the
 * cancel lands. recordDuplicate writes a MANUAL + CONFIRMED DUPLICATES edge
 * (duplicate = blocked side), reuses an existing edge for the same pair and
 * rejects a self-reference.
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
jest.mock('@/lib/repositories/task-dependency.repository', () => ({
  taskDependencyRepository: {
    findByPair: jest.fn(),
    create: jest.fn(async data => ({ id: 'edge-new', ...data })),
    update: jest.fn(async (id, data) => ({ id, ...data })),
  },
}))

import { taskService } from '@/lib/services/task.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { taskCliService } from '@/lib/services/task-cli.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { cliUpdateTaskSchema } from '@/lib/validation/schemas'

const resolveIdentifier = taskService.resolveIdentifier as jest.Mock
const updateWithSideEffects = taskService.updateTaskWithSideEffects as jest.Mock
const findByPair = taskDependencyRepository.findByPair as jest.Mock
const createEdge = taskDependencyRepository.create as jest.Mock
const updateEdge = taskDependencyRepository.update as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  resolveIdentifier.mockImplementation(
    async (_ws: string, id: string) =>
      ({
        'LUM-48': {
          id: 'task_48',
          identifier: 'LUM-48',
          title: 'Dup',
          status: 'TODO',
        },
        'LUM-12': {
          id: 'task_12',
          identifier: 'LUM-12',
          title: 'Canon',
          status: 'IN_PROGRESS',
        },
      })[id] ?? null
  )
  ;(taskService.getTaskDetail as jest.Mock).mockResolvedValue({
    id: 'task_48',
    projectId: 'proj_1',
    project: { workspaceId: 'ws_1' },
    status: 'TODO',
  })
  ;(memberRepository.findByWorkspaceAndClerkId as jest.Mock).mockResolvedValue({
    id: 'mem_1',
  })
  ;(memberRepository.findActorByMemberId as jest.Mock).mockResolvedValue({
    id: 'actor_1',
  })
  updateWithSideEffects.mockResolvedValue({
    task: {
      id: 'task_48',
      title: 'Dup',
      teamIdentifier: 'LUM',
      number: 48,
      status: 'CANCELED',
      tags: [],
    },
  })
  findByPair.mockResolvedValue(null)
})

const call = (input: Record<string, unknown>) =>
  taskCliService.updateFromCli({
    workspaceId: 'ws_1',
    workspaceSlug: 'lumo',
    callerClerkId: 'clerk_1',
    identifier: 'LUM-48',
    input,
  })

describe('updateFromCli --duplicate-of', () => {
  it('cancels, then records a DUPLICATES edge to the canonical task', async () => {
    await call({ status: 'CANCELED', duplicateOfRef: 'LUM-12' })
    expect(updateWithSideEffects).toHaveBeenCalledWith(
      'task_48',
      { status: 'CANCELED' },
      expect.any(Object),
      'actor_1',
      'clerk_1',
      null
    )
    expect(createEdge).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      blockedTaskId: 'task_48',
      blockingTaskId: 'task_12',
      kind: 'DUPLICATES',
      source: 'MANUAL',
      status: 'CONFIRMED',
      confirmedAt: expect.any(Date),
    })
    expect(updateWithSideEffects.mock.invocationCallOrder[0]!).toBeLessThan(
      createEdge.mock.invocationCallOrder[0]!
    )
  })

  it('a missing target is a 400 and nothing is written', async () => {
    await expect(
      call({ status: 'CANCELED', duplicateOfRef: 'LUM-404' })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Duplicate target LUM-404 not found',
    })
    expect(updateWithSideEffects).not.toHaveBeenCalled()
    expect(createEdge).not.toHaveBeenCalled()
  })

  it('a self-reference is a 400 and nothing is written', async () => {
    await expect(
      call({ status: 'CANCELED', duplicateOfRef: 'LUM-48' })
    ).rejects.toMatchObject({ status: 400 })
    expect(updateWithSideEffects).not.toHaveBeenCalled()
  })

  it('needs status CANCELED (service and schema both refuse it otherwise)', async () => {
    await expect(
      call({ status: 'DONE', duplicateOfRef: 'LUM-12' })
    ).rejects.toMatchObject({ status: 400 })
    expect(
      cliUpdateTaskSchema.safeParse({
        status: 'DONE',
        duplicateOfRef: 'LUM-12',
      }).success
    ).toBe(false)
    expect(
      cliUpdateTaskSchema.safeParse({
        status: 'CANCELED',
        duplicateOfRef: 'LUM-12',
      }).success
    ).toBe(true)
  })

  it('a plain cancel records no edge', async () => {
    await call({ status: 'CANCELED' })
    expect(updateWithSideEffects).toHaveBeenCalled()
    expect(createEdge).not.toHaveBeenCalled()
  })
})

describe('taskDependencyService.recordDuplicate', () => {
  const input = {
    workspaceId: 'ws_1',
    duplicateTaskId: 'task_48',
    canonicalTaskId: 'task_12',
  }

  it('rejects a self-reference', async () => {
    await expect(
      taskDependencyService.recordDuplicate({
        ...input,
        canonicalTaskId: 'task_48',
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(createEdge).not.toHaveBeenCalled()
  })

  it('turns an existing edge for the pair into the DUPLICATES edge', async () => {
    findByPair.mockResolvedValueOnce({
      id: 'edge-1',
      kind: 'BLOCKS',
      status: 'SUGGESTED',
    })
    await taskDependencyService.recordDuplicate(input)
    expect(updateEdge).toHaveBeenCalledWith('edge-1', {
      kind: 'DUPLICATES',
      status: 'CONFIRMED',
      confirmedAt: expect.any(Date),
    })
    expect(createEdge).not.toHaveBeenCalled()
  })

  it('is idempotent on an existing confirmed DUPLICATES edge', async () => {
    const existing = { id: 'edge-2', kind: 'DUPLICATES', status: 'CONFIRMED' }
    findByPair.mockResolvedValueOnce(existing)
    await expect(taskDependencyService.recordDuplicate(input)).resolves.toBe(
      existing
    )
    expect(updateEdge).not.toHaveBeenCalled()
    expect(createEdge).not.toHaveBeenCalled()
  })
})
