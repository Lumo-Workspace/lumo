/**
 * @jest-environment node
 */
// __tests__/integration/pr-mirror-flow.test.ts
import nock from 'nock'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

// This test uses heavy module-level mocks for repositories — replace as needed
// with a real test DB once factory helpers exist.

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/repositories/member.repository')
jest.mock('@/lib/repositories/github.repository')
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForComment: jest.fn().mockResolvedValue({
      id: 't1',
      number: 1,
      team: { identifier: 'TST' },
      project: { workspace: { slug: 'test-ws' } },
    }),
  },
}))
jest.mock('@/lib/utils/buildTaskUrl', () => ({
  buildTaskUrl: jest
    .fn()
    .mockReturnValue('https://app.lumo.dev/workspace/test-ws/tasks/TST-1'),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('app-token'),
}))

import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

describe('pr-mirror integration — outbound → webhook echo', () => {
  beforeEach(() => {
    // Drain helpers must return empty arrays so they don't interfere
    ;(prCommentSyncJobRepository.findDueByTask as jest.Mock).mockResolvedValue(
      []
    )
    ;(
      prCommentSyncJobRepository.findDueByPullRequest as jest.Mock
    ).mockResolvedValue([])
  })

  afterEach(() => nock.cleanAll())

  it('does not duplicate comment when GitHub fires webhook for our own POST', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      body: '<p>hi</p>',
      type: 'USER',
      authorActorId: null,
      parentId: null,
    })
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue({
      id: 'pr1',
      taskId: 't1',
      repo: 'foo/bar',
      number: 1,
      workspaceId: 'w1',
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    ;(prCommentMirrorRepository.reserve as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalId: 'pending-xxx',
    })
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue(null)
    ;(
      prCommentMirrorRepository.resolvePlaceholder as jest.Mock
    ).mockResolvedValue(undefined)

    nock('https://api.github.com')
      .post('/repos/foo/bar/issues/1/comments')
      .reply(201, {
        id: 999,
        node_id: 'IC_x',
        html_url: 'https://github.com/foo/bar/issues/1#issuecomment-999',
        updated_at: '2026-05-24T00:00:00Z',
        body: '**Author...',
      })

    // outbound POST
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalled()

    // simulate echo webhook arriving with the same externalId
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
    })

    await prCommentMirrorService.runInbound({
      event: 'issue_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://...',
          body: '**Author...',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    // Echo path: commentRepository.create must NOT have been called by inbound
    expect(commentRepository.create).not.toHaveBeenCalled()
  })
})
