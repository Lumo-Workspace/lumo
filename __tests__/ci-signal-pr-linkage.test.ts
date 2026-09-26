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

describe('ciSignalService.reconcileCommit PR linkage (LUM-617)', () => {
  it('stores the resolved pull request reference on each ci gate signal', async () => {
    fetchSignals.mockResolvedValue([
      {
        name: 'Vercel',
        outcome: 'success',
        detailsUrl: 'u',
        source: 'github_status',
      },
    ])

    await ciSignalService.reconcileCommit({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'sha1',
      taskId: 't1',
      prNumber: 753,
    })

    expect(createMany).toHaveBeenCalledTimes(1)
    const rows = createMany.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ checkName: 'Vercel', prNumber: 753 })
  })

  it('records a null PR reference when the commit resolves to no PR', async () => {
    fetchSignals.mockResolvedValue([
      {
        name: 'Vercel',
        outcome: 'success',
        detailsUrl: null,
        source: 'github_status',
      },
    ])

    await ciSignalService.reconcileCommit({
      workspaceId: 'ws',
      repo: 'a/b',
      headSha: 'sha1',
      taskId: 't1',
      prNumber: null,
    })

    const rows = createMany.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ prNumber: null })
  })
})
