/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/lumo-ci-run.repository', () => ({
  lumoCiRunRepository: {
    create: jest.fn(),
    setRunId: jest.fn(),
    finish: jest.fn(),
    findPendingByPullRequest: jest.fn(),
    countStartedSince: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrHeadSha: jest.fn(),
}))
jest.mock('@/lib/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn(),
}))
jest.mock('@/lib/services/lumo-ci-start', () => ({
  startLumoCi: jest.fn(),
  cancelLumoCiRun: jest.fn(),
}))

import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { lumoCiRunRepository } from '@/lib/repositories/lumo-ci-run.repository'
import { fetchPrHeadSha } from '@/lib/integrations/github/contents'
import { stopRepoSandboxesByTag } from '@/lib/integrations/vercel-sandbox'
import { startLumoCi, cancelLumoCiRun } from '@/lib/services/lumo-ci-start'
import { lumoCiRequestService } from '@/lib/services/lumo-ci-request.service'

const findById = pullRequestRepository.findById as jest.Mock
const repo = lumoCiRunRepository as unknown as Record<string, jest.Mock>
const headSha = fetchPrHeadSha as jest.Mock
const stopByTag = stopRepoSandboxesByTag as jest.Mock
const start = startLumoCi as jest.Mock
const cancel = cancelLumoCiRun as jest.Mock
const SHA = 'a'.repeat(40)
const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/lumo',
  number: 7,
  state: 'open',
}

beforeEach(() => {
  jest.resetAllMocks()
  delete process.env.LUMO_MANAGED_CI
  delete process.env.LUMO_MANAGED_CI_HOURLY_CAP
  delete process.env.LUMO_CI_JEST_SHARDS
  findById.mockResolvedValue(PR)
  repo.create.mockResolvedValue({ id: 'r1', created: true })
  repo.findPendingByPullRequest.mockResolvedValue([])
  repo.countStartedSince.mockResolvedValue(0)
  repo.setRunId.mockResolvedValue(undefined)
  repo.finish.mockResolvedValue(undefined)
  stopByTag.mockResolvedValue(0)
  cancel.mockResolvedValue(true)
  start.mockResolvedValue('run_1')
})

describe('lumoCiRequestService.requestRun (LUM-746)', () => {
  it('happy path: creates the row, starts the workflow with the job, stores the run id', async () => {
    await expect(
      lumoCiRequestService.requestRun({
        pullRequestId: 'pr1',
        trigger: 'PR_EVENT',
        headSha: SHA,
      })
    ).resolves.toEqual({ kind: 'started', ciRunId: 'r1', runId: 'run_1' })
    expect(headSha).not.toHaveBeenCalled()
    expect(repo.create).toHaveBeenCalledWith({
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      prNumber: 7,
      headSha: SHA,
    })
    expect(start).toHaveBeenCalledWith({
      ciRunId: 'r1',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      repo: 'o/lumo',
      prNumber: 7,
      headSha: SHA,
      jestShards: 2,
    })
    expect(repo.setRunId).toHaveBeenCalledWith('r1', 'run_1')
  })

  it('without a head sha (PR_LINK) it asks GitHub for the PR head; shard count follows the env', async () => {
    process.env.LUMO_CI_JEST_SHARDS = '3'
    headSha.mockResolvedValue(SHA)
    await lumoCiRequestService.requestRun({
      pullRequestId: 'pr1',
      trigger: 'PR_LINK',
    })
    expect(headSha).toHaveBeenCalledWith({
      workspaceId: 'w1',
      fullName: 'o/lumo',
      prNumber: 7,
    })
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ headSha: SHA, jestShards: 3 })
    )
  })

  it.each([
    [
      'disabled',
      () => {
        process.env.LUMO_MANAGED_CI = 'off'
      },
    ],
    ['pr_not_found', () => findById.mockResolvedValue(null)],
    ['no_task', () => findById.mockResolvedValue({ ...PR, taskId: null })],
    ['not_open', () => findById.mockResolvedValue({ ...PR, state: 'merged' })],
  ])('skips with %s and touches nothing', async (reason, arrange) => {
    arrange()
    await expect(
      lumoCiRequestService.requestRun({
        pullRequestId: 'pr1',
        trigger: 'PR_EVENT',
        headSha: SHA,
      })
    ).resolves.toEqual({ kind: 'skipped', reason })
    expect(repo.create).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('an invalid head sha is skipped before any row exists', async () => {
    await expect(
      lumoCiRequestService.requestRun({
        pullRequestId: 'pr1',
        trigger: 'PR_EVENT',
        headSha: 'zz',
      })
    ).resolves.toEqual({ kind: 'skipped', reason: 'invalid_head_sha' })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('same sha again: the unique collision means nothing starts', async () => {
    repo.create.mockResolvedValue({ id: 'r0', created: false })
    await expect(
      lumoCiRequestService.requestRun({
        pullRequestId: 'pr1',
        trigger: 'PR_EVENT',
        headSha: SHA,
      })
    ).resolves.toEqual({
      kind: 'skipped',
      reason: 'already_requested',
      ciRunId: 'r0',
    })
    expect(start).not.toHaveBeenCalled()
    expect(repo.findPendingByPullRequest).not.toHaveBeenCalled()
  })

  it('supersedes older PENDING runs on the PR: stamp first, then cancel the run and stop its tagged VM', async () => {
    const order: string[] = []
    repo.findPendingByPullRequest.mockResolvedValue([
      { id: 'r0', headSha: 'b'.repeat(40), runId: 'run_0' },
      { id: 'rx', headSha: 'c'.repeat(40), runId: null },
    ])
    repo.finish.mockImplementation(async (id: string) => {
      order.push(`finish:${id}`)
    })
    cancel.mockImplementation(async () => {
      order.push('cancel')
      return true
    })
    stopByTag.mockImplementation(async () => {
      order.push('stop')
      return 1
    })
    await lumoCiRequestService.requestRun({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
      headSha: SHA,
    })
    expect(repo.findPendingByPullRequest).toHaveBeenCalledWith('pr1', 'r1')
    expect(repo.finish).toHaveBeenCalledWith('r0', {
      status: 'SUPERSEDED',
      error: `superseded by ${SHA.slice(0, 7)}`,
    })
    expect(cancel).toHaveBeenCalledWith('run_0', 'r0')
    expect(cancel).toHaveBeenCalledTimes(1) // rx never started
    expect(stopByTag).toHaveBeenCalledWith({ lumoCi: 'r0' })
    expect(stopByTag).toHaveBeenCalledWith({ lumoCi: 'rx' })
    expect(order.slice(0, 3)).toEqual(['finish:r0', 'cancel', 'stop'])
    expect(start).toHaveBeenCalled()
  })

  it('a supersede stamp failure leaves that run alone and still starts the new one', async () => {
    repo.findPendingByPullRequest.mockResolvedValue([
      { id: 'r0', headSha: 'b', runId: 'run_0' },
    ])
    repo.finish.mockRejectedValueOnce(new Error('db'))
    await expect(
      lumoCiRequestService.requestRun({
        pullRequestId: 'pr1',
        trigger: 'PR_EVENT',
        headSha: SHA,
      })
    ).resolves.toMatchObject({ kind: 'started' })
    expect(cancel).not.toHaveBeenCalled()
    expect(stopByTag).not.toHaveBeenCalled()
  })

  it('hourly cap: at the cap the row is FAILED rate-limited and nothing starts', async () => {
    process.env.LUMO_MANAGED_CI_HOURLY_CAP = '3'
    repo.countStartedSince.mockResolvedValue(3)
    await expect(
      lumoCiRequestService.requestRun({
        pullRequestId: 'pr1',
        trigger: 'PR_EVENT',
        headSha: SHA,
      })
    ).resolves.toEqual({ kind: 'capped', ciRunId: 'r1' })
    expect(repo.countStartedSince).toHaveBeenCalledWith('w1', expect.any(Date))
    const since: Date = repo.countStartedSince.mock.calls[0][1]
    expect(Date.now() - since.getTime()).toBeGreaterThan(59 * 60 * 1000)
    expect(repo.finish).toHaveBeenCalledWith('r1', {
      status: 'FAILED',
      error: 'rate-limited: 3 managed CI runs started in the last hour (cap 3)',
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('start() failing stamps the row FAILED (the row never counts toward the cap)', async () => {
    start.mockResolvedValue(null)
    await expect(
      lumoCiRequestService.requestRun({
        pullRequestId: 'pr1',
        trigger: 'PR_EVENT',
        headSha: SHA,
      })
    ).resolves.toEqual({
      kind: 'failed',
      ciRunId: 'r1',
      reason: 'workflow start failed',
    })
    expect(repo.setRunId).not.toHaveBeenCalled()
    expect(repo.finish).toHaveBeenCalledWith('r1', {
      status: 'FAILED',
      error: 'workflow start failed',
    })
  })
})
