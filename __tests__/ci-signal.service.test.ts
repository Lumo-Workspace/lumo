import { ciSignalService } from '@/lib/services/ci-signal.service'
import { fetchCommitCiSignals } from '@/lib/integrations/github/checks'
import { gateSignalRepository } from '@/lib/repositories/gate-signal.repository'
import { logger } from '@/lib/logger'

jest.mock('@/lib/integrations/github/checks', () => ({
  fetchCommitCiSignals: jest.fn(),
}))
jest.mock('@/lib/repositories/gate-signal.repository', () => ({
  gateSignalRepository: { createMany: jest.fn(), findByTaskId: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

const fetchSignals = fetchCommitCiSignals as jest.Mock
const createMany = gateSignalRepository.createMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('ciSignalService.reconcileCommit (LUM-616)', () => {
  it('reconcileCommit writes signal rows for recognized checks linked to the task', async () => {
    fetchSignals.mockResolvedValue([
      {
        name: 'Vercel',
        outcome: 'success',
        detailsUrl: 'u',
        source: 'github_check',
      },
      // unrecognized name → dropped (never a fabricated gate)
      {
        name: 'lint',
        outcome: 'failure',
        detailsUrl: null,
        source: 'github_check',
      },
      // not-yet-a-verdict → skipped
      {
        name: 'test',
        outcome: 'skip',
        detailsUrl: null,
        source: 'github_check',
      },
    ])

    await ciSignalService.reconcileCommit({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'sha1',
      taskId: 't1',
    })

    expect(fetchSignals).toHaveBeenCalledWith({
      workspaceId: 'ws',
      fullName: 'a/b',
      sha: 'sha1',
    })
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(createMany).toHaveBeenCalledWith([
      {
        workspaceId: 'ws',
        taskId: 't1',
        gateKey: 'build',
        outcome: 'success',
        provenance: 'independent_harness',
        source: 'github_check',
        checkName: 'Vercel',
        detailsUrl: 'u',
        headSha: 'sha1',
        prNumber: null,
      },
    ])
  })

  it('is a no-op when no task is associated', async () => {
    await ciSignalService.reconcileCommit({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'sha1',
      taskId: null,
    })
    expect(fetchSignals).not.toHaveBeenCalled()
    expect(createMany).not.toHaveBeenCalled()
  })

  it('never throws when CI fetch fails (fail-soft)', async () => {
    fetchSignals.mockRejectedValue(new Error('github down'))
    await expect(
      ciSignalService.reconcileCommit({
        workspaceId: 'ws',
        repo: 'a/b',
        headSha: 'sha1',
        taskId: 't1',
      })
    ).resolves.toBeUndefined()
    expect(createMany).not.toHaveBeenCalled()
  })

  it('writes nothing when no check is recognized', async () => {
    fetchSignals.mockResolvedValue([
      {
        name: 'lint',
        outcome: 'failure',
        detailsUrl: null,
        source: 'github_check',
      },
    ])
    await ciSignalService.reconcileCommit({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'sha1',
      taskId: 't1',
    })
    expect(createMany).not.toHaveBeenCalled()
  })
})

describe('ciSignalService.reconcileCommit — CI that never ran (LUM-838)', () => {
  it('a check that did not run is logged and never recorded as a gate verdict', async () => {
    fetchSignals.mockResolvedValue([
      {
        name: 'test',
        outcome: 'not_run',
        detailsUrl: 'https://ci/job/1',
        source: 'github_check',
        notRunReason: 'The job was not started because of a spending limit',
      },
      {
        name: 'typecheck',
        outcome: 'not_run',
        detailsUrl: 'https://ci/job/2',
        source: 'github_check',
        notRunReason: 'The job was not started because of a spending limit',
      },
    ])

    await ciSignalService.reconcileCommit({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'sha1',
      taskId: 't1',
      prNumber: 1099,
    })

    expect(createMany).not.toHaveBeenCalled()
    const lines = (logger.info as jest.Mock).mock.calls.map(c => String(c[0]))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(
      'CI did not run: The job was not started because of a spending limit'
    )
    expect(lines[0]).toContain('test')
    expect(lines[0]).toContain('a/b@sha1')
  })
})
