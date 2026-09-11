/** @jest-environment node */
jest.mock('@/lib/workflows/lumo-ci.steps', () => ({
  prepareCiSandboxStep: jest.fn(),
  runCiCheckStep: jest.fn(),
  recordCiOutcomeStep: jest.fn(),
  stopCiSandboxStep: jest.fn(),
}))

import { lumoCiWorkflow } from '@/lib/workflows/lumo-ci'
import {
  prepareCiSandboxStep,
  runCiCheckStep,
  recordCiOutcomeStep,
  stopCiSandboxStep,
} from '@/lib/workflows/lumo-ci.steps'

const prepare = prepareCiSandboxStep as jest.Mock
const run = runCiCheckStep as jest.Mock
const record = recordCiOutcomeStep as jest.Mock
const stop = stopCiSandboxStep as jest.Mock
const SANDBOX = { name: 'sb-1', cwd: '/vercel/lumo' }
const JOB = {
  ciRunId: 'r1',
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
  repo: 'o/lumo',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  jestShards: 2,
}

beforeEach(() => {
  jest.resetAllMocks()
  record.mockResolvedValue({ status: 'DONE', signals: 2 })
  stop.mockResolvedValue(undefined)
})

describe('lumoCiWorkflow (LUM-746)', () => {
  it('prepare → typecheck → one step per jest shard → record (both ran) → stop; returns DONE', async () => {
    prepare.mockResolvedValue({ kind: 'ready', sandbox: SANDBOX })
    run
      .mockResolvedValueOnce({ kind: 'ran', exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ kind: 'ran', exitCode: 0 }) // shard 1/2
      .mockResolvedValueOnce({ kind: 'ran', exitCode: 1 }) // shard 2/2
    await expect(lumoCiWorkflow(JOB)).resolves.toEqual({
      outcome: 'DONE',
      ciRunId: 'r1',
      signals: 2,
    })
    expect(prepare).toHaveBeenCalledWith(JOB)
    expect(run).toHaveBeenNthCalledWith(1, {
      sandbox: SANDBOX,
      headSha: JOB.headSha,
      spec: { check: 'typecheck' },
    })
    expect(run).toHaveBeenNthCalledWith(2, {
      sandbox: SANDBOX,
      headSha: JOB.headSha,
      spec: { check: 'test', shard: { index: 1, total: 2 } },
    })
    expect(run).toHaveBeenNthCalledWith(3, {
      sandbox: SANDBOX,
      headSha: JOB.headSha,
      spec: { check: 'test', shard: { index: 2, total: 2 } },
    })
    expect(record).toHaveBeenCalledWith({
      job: JOB,
      results: {
        typecheck: { kind: 'ran', exitCode: 0 },
        test: { kind: 'ran', exitCode: 1 },
      },
    })
    expect(stop).toHaveBeenCalledWith(SANDBOX)
    // The VM is released before the write-back so a slow record never bills.
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
      record.mock.invocationCallOrder[0]!
    )
  })

  it('a single shard runs jest without a shard flag', async () => {
    prepare.mockResolvedValue({ kind: 'ready', sandbox: SANDBOX })
    run.mockResolvedValue({ kind: 'ran', exitCode: 0 })
    await lumoCiWorkflow({ ...JOB, jestShards: 1 })
    expect(run).toHaveBeenNthCalledWith(2, {
      sandbox: SANDBOX,
      headSha: JOB.headSha,
      spec: { check: 'test' },
    })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        results: {
          typecheck: { kind: 'ran', exitCode: 0 },
          test: { kind: 'ran', exitCode: 0 },
        },
      })
    )
  })

  it('prepare failed (value): no check runs, no stop, both checks recorded as harness failures', async () => {
    prepare.mockResolvedValue({ kind: 'failed', reason: 'prepare exit 1' })
    record.mockResolvedValue({ status: 'FAILED', signals: 0 })
    await expect(lumoCiWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      ciRunId: 'r1',
      signals: 0,
    })
    expect(run).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith({
      job: JOB,
      results: {
        typecheck: { kind: 'failed', reason: 'prepare exit 1' },
        test: { kind: 'failed', reason: 'prepare exit 1' },
      },
    })
  })

  it('prepare threw (retries exhausted): same as a failed prepare, with the error as reason', async () => {
    prepare.mockRejectedValue(new Error('sandbox create 503'))
    record.mockResolvedValue({ status: 'FAILED', signals: 0 })
    await expect(lumoCiWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'FAILED',
    })
    expect(record).toHaveBeenCalledWith({
      job: JOB,
      results: {
        typecheck: { kind: 'failed', reason: 'prepare: sandbox create 503' },
        test: { kind: 'failed', reason: 'prepare: sandbox create 503' },
      },
    })
  })

  it('a lost shard fails the test check but typecheck still records; a thrown check step is a harness failure too', async () => {
    prepare.mockResolvedValue({ kind: 'ready', sandbox: SANDBOX })
    run
      .mockResolvedValueOnce({ kind: 'ran', exitCode: 0 })
      .mockResolvedValueOnce({ kind: 'ran', exitCode: 0 })
      .mockRejectedValueOnce(new Error('step exploded'))
    record.mockResolvedValue({ status: 'FAILED', signals: 1 })
    await expect(lumoCiWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      ciRunId: 'r1',
      signals: 1,
    })
    expect(record).toHaveBeenCalledWith({
      job: JOB,
      results: {
        typecheck: { kind: 'ran', exitCode: 0 },
        test: { kind: 'failed', reason: 'shard 2/2: step exploded' },
      },
    })
    expect(stop).toHaveBeenCalledWith(SANDBOX)
  })

  it('a failing stop never changes the outcome', async () => {
    prepare.mockResolvedValue({ kind: 'ready', sandbox: SANDBOX })
    run.mockResolvedValue({ kind: 'ran', exitCode: 0 })
    stop.mockRejectedValue(new Error('stop failed'))
    await expect(lumoCiWorkflow(JOB)).resolves.toMatchObject({
      outcome: 'DONE',
    })
    expect(record).toHaveBeenCalled()
  })

  it('record threw (retries exhausted): the run reports FAILED with 0 signals rather than throwing', async () => {
    prepare.mockResolvedValue({ kind: 'ready', sandbox: SANDBOX })
    run.mockResolvedValue({ kind: 'ran', exitCode: 0 })
    record.mockRejectedValue(new Error('db down'))
    await expect(lumoCiWorkflow(JOB)).resolves.toEqual({
      outcome: 'FAILED',
      ciRunId: 'r1',
      signals: 0,
      reason: 'record: db down',
    })
  })
})
