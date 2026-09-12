// __tests__/services/pr-comment-mirror/run-outbound-delete.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { commentRepository } from '@/lib/repositories/comment.repository'

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/integrations/github/pr-comment-client')
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('app-token'),
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findByActorId: jest.fn() },
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByUserAndWorkspace: jest.fn(),
    findIntegrationByLogin: jest.fn(),
  },
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')

describe('runOutbound DELETE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const { prCommentSyncJobRepository: sjRepo } = jest.requireMock(
      '@/lib/repositories/pr-comment-sync-job.repository'
    ) as typeof import('@/lib/repositories/pr-comment-sync-job.repository')
    ;(sjRepo.findDueByTask as jest.Mock).mockResolvedValue([])
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      type: 'USER',
      authorActorId: null,
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'ISSUE',
        externalId: '999',
        outboundActor: 'BOT_APP',
        outboundActorUserId: null,
      }
    )
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue({
      id: 'pr1',
      repo: 'foo/bar',
      number: 42,
      workspaceId: 'w1',
    })
    ;(prCommentClient.deleteIssueComment as jest.Mock).mockResolvedValue(
      undefined
    )
    ;(prCommentClient.deleteReviewLineComment as jest.Mock).mockResolvedValue(
      undefined
    )
    ;(prCommentMirrorRepository.markDeleted as jest.Mock).mockResolvedValue({
      id: 'm1',
      deletedAt: new Date(),
    })
  })

  it('calls deleteIssueComment for ISSUE source', async () => {
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(prCommentClient.deleteIssueComment).toHaveBeenCalled()
  })

  it('calls deleteReviewLineComment for REVIEW_LINE source', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'REVIEW_LINE',
        externalId: '999',
        outboundActor: 'BOT_APP',
        outboundActorUserId: null,
      }
    )
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(prCommentClient.deleteReviewLineComment).toHaveBeenCalled()
  })

  it('marks mirror deletedAt after success', async () => {
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(prCommentMirrorRepository.markDeleted).toHaveBeenCalledWith('m1')
  })

  it('no-ops when no mirror row', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(prCommentClient.deleteIssueComment).not.toHaveBeenCalled()
  })

  it("skips a legacy user-authored mirror — the App cannot delete a person's comment", async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm-legacy',
        externalSource: 'ISSUE',
        externalId: '999',
        outboundActor: 'USER_OAUTH',
        outboundActorUserId: 'm1',
      }
    )

    await prCommentMirrorService.runOutbound('c1', 'DELETE')

    expect(prCommentClient.deleteIssueComment).not.toHaveBeenCalled()
  })
})
