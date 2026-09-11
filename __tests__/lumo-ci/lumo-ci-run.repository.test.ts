/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    lumoCiRun: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { lumoCiRunRepository } from '@/lib/repositories/lumo-ci-run.repository'

const db = prisma.lumoCiRun as unknown as {
  create: jest.Mock
  findUnique: jest.Mock
  update: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
}
const INPUT = {
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
  prNumber: 7,
  headSha: 'a'.repeat(40),
}

beforeEach(() => jest.resetAllMocks())

describe('lumoCiRunRepository (LUM-746)', () => {
  it('create inserts a PENDING row and reports created=true', async () => {
    db.create.mockResolvedValue({ id: 'r1' })
    await expect(lumoCiRunRepository.create(INPUT)).resolves.toEqual({
      id: 'r1',
      created: true,
    })
    expect(db.create).toHaveBeenCalledWith({
      data: { ...INPUT, status: 'PENDING' },
      select: { id: true },
    })
  })

  it('create on the (pullRequestId, headSha) unique collision returns the existing row with created=false', async () => {
    db.create.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'P2002' })
    )
    db.findUnique.mockResolvedValue({ id: 'r0' })
    await expect(lumoCiRunRepository.create(INPUT)).resolves.toEqual({
      id: 'r0',
      created: false,
    })
    expect(db.findUnique).toHaveBeenCalledWith({
      where: {
        pullRequestId_headSha: { pullRequestId: 'pr1', headSha: INPUT.headSha },
      },
      select: { id: true },
    })
  })

  it('create rethrows non-unique errors', async () => {
    db.create.mockRejectedValue(new Error('boom'))
    await expect(lumoCiRunRepository.create(INPUT)).rejects.toThrow('boom')
  })

  it('setRunId stores the workflow run id', async () => {
    db.update.mockResolvedValue({})
    await lumoCiRunRepository.setRunId('r1', 'run_1')
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { runId: 'run_1' },
    })
  })

  it('finish stamps status, error and finishedAt', async () => {
    db.update.mockResolvedValue({})
    await lumoCiRunRepository.finish('r1', { status: 'FAILED', error: 'x' })
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'FAILED', error: 'x', finishedAt: expect.any(Date) },
    })
    await lumoCiRunRepository.finish('r1', { status: 'DONE' })
    expect(db.update).toHaveBeenLastCalledWith({
      where: { id: 'r1' },
      data: { status: 'DONE', error: null, finishedAt: expect.any(Date) },
    })
  })

  it('findPendingByPullRequest lists the other PENDING rows of the PR', async () => {
    db.findMany.mockResolvedValue([{ id: 'r0', headSha: 'b', runId: 'run_0' }])
    await expect(
      lumoCiRunRepository.findPendingByPullRequest('pr1', 'r1')
    ).resolves.toEqual([{ id: 'r0', headSha: 'b', runId: 'run_0' }])
    expect(db.findMany).toHaveBeenCalledWith({
      where: { pullRequestId: 'pr1', id: { not: 'r1' }, status: 'PENDING' },
      select: { id: true, headSha: true, runId: true },
    })
  })

  it('countStartedSince counts only rows whose run actually started', async () => {
    db.count.mockResolvedValue(4)
    const since = new Date('2026-09-10T00:00:00Z')
    await expect(
      lumoCiRunRepository.countStartedSince('w1', since)
    ).resolves.toBe(4)
    expect(db.count).toHaveBeenCalledWith({
      where: {
        workspaceId: 'w1',
        runId: { not: null },
        startedAt: { gte: since },
      },
    })
  })
})
