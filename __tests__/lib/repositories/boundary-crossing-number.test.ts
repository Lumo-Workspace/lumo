/**
 * @jest-environment node
 *
 * LUM-1059 — `boundaryCrossingRepository.create` allocates the crossing's
 * per-workspace number from Workspace.crossingSeq inside the same transaction
 * as the insert, resolving the workspace from the task or, for a steward
 * crossing, from the milestone's project.
 */
const tx = {
  task: { findUnique: jest.fn() },
  milestone: { findUnique: jest.fn() },
  workspace: { update: jest.fn() },
  boundaryCrossing: { create: jest.fn(), findFirst: jest.fn() },
}
const mockTransaction = jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: (fn: (c: unknown) => unknown) => mockTransaction(fn as never),
    boundaryCrossing: {
      findFirst: (...a: unknown[]) => tx.boundaryCrossing.findFirst(...a),
    },
  },
}))

import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

const BASE = {
  category: 'TEST_FILE_DELETED' as const,
  detail: 'deleted x.test.ts',
  severity: 'MEDIUM' as const,
}

beforeEach(() => {
  jest.clearAllMocks()
  tx.boundaryCrossing.create.mockImplementation(async (a: unknown) => a)
})

describe('LUM-1059 crossing number allocation', () => {
  it('LUM-1059 a task crossing takes the next number of the task workspace in the create transaction', async () => {
    tx.task.findUnique.mockResolvedValue({ workspaceId: 'w-1' })
    tx.workspace.update.mockResolvedValue({ crossingSeq: 42 })

    await boundaryCrossingRepository.create({ ...BASE, taskId: 't-1' })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: 'w-1' },
      data: { crossingSeq: { increment: 1 } },
      select: { crossingSeq: true },
    })
    const data = tx.boundaryCrossing.create.mock.calls[0][0].data
    expect(data.workspaceId).toBe('w-1')
    expect(data.number).toBe(42)
  })

  it('LUM-1059 a steward crossing numbers in its milestone project workspace', async () => {
    tx.milestone.findUnique.mockResolvedValue({
      project: { workspaceId: 'w-2' },
    })
    tx.workspace.update.mockResolvedValue({ crossingSeq: 5 })

    await boundaryCrossingRepository.create({
      ...BASE,
      taskId: null,
      milestoneId: 'm-1',
    })

    expect(tx.task.findUnique).not.toHaveBeenCalled()
    const data = tx.boundaryCrossing.create.mock.calls[0][0].data
    expect(data.workspaceId).toBe('w-2')
    expect(data.number).toBe(5)
  })

  it('LUM-1059 concurrent creates each get a distinct number from the counter', async () => {
    tx.task.findUnique.mockResolvedValue({ workspaceId: 'w-1' })
    let seq = 0
    tx.workspace.update.mockImplementation(async () => ({
      crossingSeq: ++seq,
    }))

    await Promise.all(
      [1, 2, 3].map(() =>
        boundaryCrossingRepository.create({ ...BASE, taskId: 't-1' })
      )
    )
    const numbers = tx.boundaryCrossing.create.mock.calls
      .map(c => c[0].data.number)
      .sort()
    expect(numbers).toEqual([1, 2, 3])
  })

  it('LUM-1059 a create inside a caller transaction reuses it', async () => {
    tx.task.findUnique.mockResolvedValue({ workspaceId: 'w-1' })
    tx.workspace.update.mockResolvedValue({ crossingSeq: 1 })
    await boundaryCrossingRepository.create(
      { ...BASE, taskId: 't-1' },
      tx as never
    )
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(tx.boundaryCrossing.create).toHaveBeenCalledTimes(1)
  })

  it('LUM-1059 findIdByTaskAndNumber scopes to the task and, when named, its team', async () => {
    tx.boundaryCrossing.findFirst.mockResolvedValue({ id: 'cuid-9' })
    await expect(
      boundaryCrossingRepository.findIdByTaskAndNumber('t-1', 9, 'LUM')
    ).resolves.toBe('cuid-9')
    expect(tx.boundaryCrossing.findFirst.mock.calls[0][0].where).toEqual({
      taskId: 't-1',
      number: 9,
      task: {
        team: { identifier: { equals: 'LUM', mode: 'insensitive' } },
      },
    })
  })
})
