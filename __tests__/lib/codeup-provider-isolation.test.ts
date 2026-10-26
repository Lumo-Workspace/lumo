/**
 * @jest-environment node
 *
 * LUM-1315 — a `provider: 'codeup'` PR row is never handed to a GitHub
 * path: the task page's PR refresh skips it, and every PullRequest reader
 * whose rows go to the GitHub API filters on `provider: 'github'`.
 */
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { findByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  stampLineageInBackground: jest.fn(),
}))
jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn().mockResolvedValue(new Map()),
}))

import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { storedRepoSpellings } from '@/lib/repositories/repo-spellings'
import { syncPullRequestStatus } from '@/lib/services/task-pr-sync.service'
import { taskService } from '@/lib/services/task.service'

const findMany = prisma.pullRequest.findMany as jest.Mock
const findFirst = prisma.pullRequest.findFirst as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('task page PR refresh', () => {
  it('sends only open GitHub PRs to the GitHub sync — a Codeup MR is skipped', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 'task_1',
      status: 'IN_PROGRESS',
      project: { workspaceId: 'ws_1' },
      team: { identifier: 'LUM', sprintsEnabled: false },
      parent: null,
      pullRequests: [
        {
          id: 'pr_gh',
          provider: 'github',
          number: 3,
          url: 'https://github.com/acme/web/pull/3',
          state: 'open',
          title: 'Web',
          ciStatus: null,
        },
        {
          id: 'pr_cu',
          provider: 'codeup',
          number: 1,
          url: 'https://codeup.aliyun.com/demo/demo/merge_requests/1',
          state: 'open',
          title: 'MR',
          ciStatus: null,
        },
      ],
    })

    const detail = await taskService.getTaskDetail('task_1')

    const sent = (syncPullRequestStatus as jest.Mock).mock.calls[0]![1] as {
      id: string
    }[]
    expect(sent.map(pr => pr.id)).toEqual(['pr_gh'])
    // The Codeup MR is still shown on the task.
    expect(detail!.pullRequests.map(pr => pr.id)).toEqual(['pr_gh', 'pr_cu'])
  })

  it('does not call the GitHub sync when the only open PR is a Codeup MR', async () => {
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 'task_1',
      status: 'IN_PROGRESS',
      project: { workspaceId: 'ws_1' },
      team: { identifier: 'LUM', sprintsEnabled: false },
      parent: null,
      pullRequests: [
        {
          id: 'pr_cu',
          provider: 'codeup',
          number: 1,
          url: 'https://codeup.aliyun.com/demo/demo/merge_requests/1',
          state: 'open',
          title: 'MR',
          ciStatus: null,
        },
      ],
    })
    await taskService.getTaskDetail('task_1')
    expect(syncPullRequestStatus).not.toHaveBeenCalled()
  })
})

describe('PullRequest readers that feed the GitHub API filter on provider github', () => {
  const where = (mock: jest.Mock) =>
    (mock.mock.calls[0]![0] as { where: Record<string, unknown> }).where

  it.each([
    [
      'findStaleOpenByProject (stale PR reconcile)',
      () => pullRequestRepository.findStaleOpenByProject('p1', new Date(), 5),
      findMany,
    ],
    [
      'listMergedTaskBoundMissingChangeVolume (change-volume backfill)',
      () => pullRequestRepository.listMergedTaskBoundMissingChangeVolume(),
      findMany,
    ],
    [
      'listMergedByTask (claim-faithfulness GitHub diffs)',
      () => pullRequestRepository.listMergedByTask('t1'),
      findMany,
    ],
    [
      'listRepoAndNumberByTask (crossing re-judge file lists)',
      () => pullRequestRepository.listRepoAndNumberByTask('t1'),
      findMany,
    ],
    [
      'findAllByRepoAndNumber (SARIF ingest)',
      () => pullRequestRepository.findAllByRepoAndNumber('acme/web', 1),
      findMany,
    ],
    [
      'findByNumberInWorkspace (scan read-out / review controls)',
      () => pullRequestRepository.findByNumberInWorkspace('ws', 1, null),
      findMany,
    ],
    [
      'findManyForSecurityByTaskId (security scan gate)',
      () => pullRequestRepository.findManyForSecurityByTaskId('t1'),
      findMany,
    ],
    [
      'findIdsByRepos (repository rename scrub)',
      () => pullRequestRepository.findIdsByRepos('ws', ['acme/web']),
      findMany,
    ],
    [
      'findActivePr (GitHub code pipeline)',
      () => pullRequestRepository.findActivePr('t1'),
      findFirst,
    ],
    [
      'findByHeadBranch (GitHub status events)',
      () => pullRequestRepository.findByHeadBranch('ws', 'acme/web', 'b'),
      findFirst,
    ],
    [
      'findMergedDeliveryByMergeCommitSha (GitHub revert feed)',
      () =>
        pullRequestRepository.findMergedDeliveryByMergeCommitSha('ws', 'sha'),
      findFirst,
    ],
  ])('%s', async (_name, run, mock) => {
    await run()
    expect(where(mock)).toMatchObject({ provider: 'github' })
  })

  it('findByTaskId filters to GitHub only for GitHub callers', async () => {
    await pullRequestRepository.findByTaskId('t1', { githubOnly: true })
    expect(where(findFirst)).toEqual({ taskId: 't1', provider: 'github' })
    findFirst.mockClear()
    await pullRequestRepository.findByTaskId('t1')
    expect(where(findFirst)).toEqual({ taskId: 't1' })
  })

  it('storedRepoSpellings only reads GitHub rows', async () => {
    await storedRepoSpellings('ws', ['acme/web'])
    const groupBy = prisma.pullRequest.groupBy as unknown as jest.Mock
    expect(
      (groupBy.mock.calls[0]![0] as { where: Record<string, unknown> }).where
    ).toMatchObject({ provider: 'github' })
  })
})
