/**
 * @jest-environment node
 */
// __tests__/services/pr-comment-mirror/run-outbound-update.test.ts

// Mock heavy transitive deps before any imports
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('app-token'),
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/repositories/member.repository')
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByUserAndWorkspace: jest.fn(),
    findIntegrationByLogin: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForComment: jest.fn().mockResolvedValue({
      id: 't1',
      number: 10,
      team: { identifier: 'LUM' },
      project: { workspace: { slug: 'my-workspace' } },
    }),
  },
}))
jest.mock('@/lib/utils/buildTaskUrl', () => ({
  buildTaskUrl: jest
    .fn()
    .mockReturnValue(
      'https://app.lumo.dev/workspace/my-workspace/tasks/LUM-10'
    ),
}))
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: {
      getUser: jest.fn().mockResolvedValue({
        firstName: 'Someone',
        lastName: null,
        emailAddresses: [],
      }),
    },
  }),
}))

import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/integrations/github/pr-comment-client')

describe('runOutbound UPDATE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const { prCommentSyncJobRepository: sjRepo } = jest.requireMock(
      '@/lib/repositories/pr-comment-sync-job.repository'
    ) as typeof import('@/lib/repositories/pr-comment-sync-job.repository')
    ;(sjRepo.findDueByTask as jest.Mock).mockResolvedValue([])
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      body: '<p>edited</p>',
      type: 'USER',
      authorActorId: 'a1',
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'ISSUE',
        externalId: '999',
        outboundActor: 'BOT_APP',
      }
    )
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue({
      id: 'pr1',
      repo: 'foo/bar',
      number: 42,
      workspaceId: 'w1',
    })
    ;(prCommentClient.updateIssueComment as jest.Mock).mockResolvedValue({
      id: 999,
      node_id: 'IC_x',
      html_url: 'https://...',
      updated_at: '2026-05-24T01:00:00Z',
      body: 'edited',
    })
  })

  it('PATCHes the issue comment via prCommentClient.updateIssueComment', async () => {
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(prCommentClient.updateIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '999' })
    )
  })

  it('PATCHes review-line endpoint when source is REVIEW_LINE', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'REVIEW_LINE',
        externalId: '999',
        outboundActor: 'BOT_APP',
      }
    )
    ;(prCommentClient.updateReviewLineComment as jest.Mock).mockResolvedValue({
      id: 999,
      node_id: 'PRRC_x',
      html_url: 'https://...',
      updated_at: '2026-05-24T01:00:00Z',
      body: 'edited',
    })
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(prCommentClient.updateReviewLineComment).toHaveBeenCalled()
  })

  it('patches mirror.externalUpdatedAt + bodyHash after success', async () => {
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(prCommentMirrorRepository.patchAfterEdit).toHaveBeenCalledWith(
      'm1',
      new Date('2026-05-24T01:00:00Z'),
      expect.any(String)
    )
  })

  it('no-ops if no mirror row exists (nothing to update)', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(prCommentClient.updateIssueComment).not.toHaveBeenCalled()
  })

  it('skips a legacy user-authored mirror instead of 403-looping on GitHub', async () => {
    // Written before the App-only consolidation: the GitHub comment belongs to
    // a person, so the App can neither edit nor delete it. Attempting it earns
    // a 403 whose catch re-enqueues the job — forever.
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm-legacy',
        externalSource: 'ISSUE',
        externalId: '999',
        outboundActor: 'USER_OAUTH',
        outboundActorUserId: 'm1',
      }
    )

    await prCommentMirrorService.runOutbound('c1', 'UPDATE')

    expect(prCommentClient.updateIssueComment).not.toHaveBeenCalled()
    const { prCommentSyncJobRepository } = jest.requireMock(
      '@/lib/repositories/pr-comment-sync-job.repository'
    ) as typeof import('@/lib/repositories/pr-comment-sync-job.repository')
    expect(prCommentSyncJobRepository.enqueue).not.toHaveBeenCalled()
  })
})
