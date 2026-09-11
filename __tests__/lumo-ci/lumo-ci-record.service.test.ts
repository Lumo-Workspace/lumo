/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/gate-signal.repository', () => ({
  gateSignalRepository: { createMany: jest.fn() },
}))
jest.mock('@/lib/repositories/lumo-ci-run.repository', () => ({
  lumoCiRunRepository: { finish: jest.fn() },
}))

import { gateSignalRepository } from '@/lib/repositories/gate-signal.repository'
import { lumoCiRunRepository } from '@/lib/repositories/lumo-ci-run.repository'
import { lumoCiRecordService } from '@/lib/services/lumo-ci-record.service'

const createMany = gateSignalRepository.createMany as jest.Mock
const finish = lumoCiRunRepository.finish as jest.Mock
const JOB = {
  ciRunId: 'r1',
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  jestShards: 2,
}

beforeEach(() => {
  jest.resetAllMocks()
  createMany.mockResolvedValue(2)
  finish.mockResolvedValue(undefined)
})

describe('lumoCiRecordService.record (LUM-746)', () => {
  it('writes one independent lumo_sandbox GateSignal per check that ran and marks the run DONE', async () => {
    await expect(
      lumoCiRecordService.record({
        job: JOB,
        results: {
          typecheck: { kind: 'ran', exitCode: 0 },
          test: { kind: 'ran', exitCode: 1 },
        },
      })
    ).resolves.toEqual({ status: 'DONE', signals: 2 })
    expect(createMany).toHaveBeenCalledWith([
      {
        workspaceId: 'w1',
        taskId: 't1',
        gateKey: 'typecheck',
        outcome: 'success',
        provenance: 'independent_harness',
        source: 'lumo_sandbox',
        checkName: 'lumo/ci typecheck',
        detailsUrl: null,
        headSha: JOB.headSha,
        prNumber: 7,
      },
      {
        workspaceId: 'w1',
        taskId: 't1',
        gateKey: 'test',
        outcome: 'failure',
        provenance: 'independent_harness',
        source: 'lumo_sandbox',
        checkName: 'lumo/ci test',
        detailsUrl: null,
        headSha: JOB.headSha,
        prNumber: 7,
      },
    ])
    expect(finish).toHaveBeenCalledWith('r1', { status: 'DONE' })
  })

  it('a check the harness failed writes no signal; the other still lands; the run is FAILED with the reason', async () => {
    createMany.mockResolvedValue(1)
    await expect(
      lumoCiRecordService.record({
        job: JOB,
        results: {
          typecheck: { kind: 'ran', exitCode: 0 },
          test: { kind: 'failed', reason: 'shard 2/2: sha guard exit 90' },
        },
      })
    ).resolves.toEqual({ status: 'FAILED', signals: 1 })
    expect(createMany).toHaveBeenCalledWith([
      expect.objectContaining({ gateKey: 'typecheck', outcome: 'success' }),
    ])
    expect(finish).toHaveBeenCalledWith('r1', {
      status: 'FAILED',
      error: 'test: shard 2/2: sha guard exit 90',
    })
  })

  it('nothing ran: no createMany call at all, run FAILED with every reason', async () => {
    await expect(
      lumoCiRecordService.record({
        job: JOB,
        results: {
          typecheck: { kind: 'failed', reason: 'prepare: npm ci exit 1' },
          test: { kind: 'failed', reason: 'prepare: npm ci exit 1' },
        },
      })
    ).resolves.toEqual({ status: 'FAILED', signals: 0 })
    expect(createMany).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith('r1', {
      status: 'FAILED',
      error: 'typecheck: prepare: npm ci exit 1; test: prepare: npm ci exit 1',
    })
  })
})
