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

function row(overrides: Record<string, unknown>) {
  return {
    workspaceId: 'ws',
    taskId: 't1',
    gateKey: null,
    provenance: 'independent_harness',
    source: 'github_check',
    headSha: 'sha1',
    prNumber: null,
    ...overrides,
  }
}

describe('ciSignalService.reconcileCommit (LUM-616 / LUM-839)', () => {
  it('records every completed CI check under its own name', async () => {
    fetchSignals.mockResolvedValue([
      {
        name: 'Vercel',
        outcome: 'success',
        detailsUrl: 'u',
        source: 'github_check',
      },
      // A name no fixed taxonomy would recognize is kept, not dropped.
      {
        name: 'lint-and-format',
        outcome: 'failure',
        detailsUrl: null,
        source: 'github_status',
      },
      // LUM-838: never started → recorded as not_run, never as a failure.
      {
        name: 'e2e',
        outcome: 'not_run',
        detailsUrl: 'https://ci/job/3',
        source: 'github_check',
        notRunReason: 'The job was not started because of a spending limit',
      },
      // Pending / neutral / skipped → not a result yet, nothing recorded.
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
      row({ outcome: 'success', checkName: 'Vercel', detailsUrl: 'u' }),
      row({
        outcome: 'failure',
        checkName: 'lint-and-format',
        detailsUrl: null,
        source: 'github_status',
      }),
      row({
        outcome: 'not_run',
        checkName: 'e2e',
        detailsUrl: 'https://ci/job/3',
      }),
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

  it('writes nothing while every check is still pending', async () => {
    fetchSignals.mockResolvedValue([
      {
        name: 'lint',
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
    expect(createMany).not.toHaveBeenCalled()
  })
})

describe('ciSignalService.reconcileCommit — CI that never ran (LUM-838)', () => {
  it('a check that did not run is logged with its reason and stored as not_run', async () => {
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

    const stored = createMany.mock.calls[0][0] as { outcome: string }[]
    expect(stored.map(r => r.outcome)).toEqual(['not_run', 'not_run'])
    const lines = (logger.info as jest.Mock).mock.calls.map(c => String(c[0]))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(
      'CI did not run: The job was not started because of a spending limit'
    )
    expect(lines[0]).toContain('test')
    expect(lines[0]).toContain('a/b@sha1')
  })
})
