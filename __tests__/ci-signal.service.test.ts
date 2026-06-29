import { ciSignalService } from '@/lib/services/ci-signal.service'
import { fetchCommitCiSignals } from '@/lib/integrations/github/checks'
import { gateSignalRepository } from '@/lib/repositories/gate-signal.repository'

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
