/**
 * @jest-environment node
 */

// Mock heavy transitive deps before any imports
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('app-token'),
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')
jest.mock('@/lib/repositories/member.repository')
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByUserAndWorkspace: jest.fn(),
    findIntegrationByLogin: jest.fn(),
  },
}))
jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn().mockResolvedValue({
    getUser: jest.fn().mockResolvedValue({
      firstName: 'Someone',
      lastName: null,
      emailAddresses: [],
    }),
  }),
}))

import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

describe('drain-on-event', () => {
  beforeEach(() => jest.clearAllMocks())

  it('runOutbound drains pending OUTBOUND jobs for the same task before its own work', async () => {
    // Arrange a pending job for the same task as our incoming work
    ;(prCommentSyncJobRepository.findDueByTask as jest.Mock).mockResolvedValue([
      {
        id: 'j-prior',
        direction: 'OUTBOUND',
        commentId: 'c-old',
        payload: { op: 'CREATE' },
        attempts: 0,
      },
    ])
    // Skip the actual main-path work for this test by stubbing the lookups to return no PR
    const { pullRequestRepository } =
      await import('@/lib/repositories/pull-request.repository')
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(null)
    const { commentRepository } =
      await import('@/lib/repositories/comment.repository')
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      type: 'USER',
    })

    await prCommentMirrorService.runOutbound('c1', 'CREATE')

    expect(prCommentSyncJobRepository.findDueByTask).toHaveBeenCalledWith(
      't1',
      { limit: 10 }
    )
  })

  it('drain failures escalate to dead-letter after 3rd attempt', async () => {
    ;(prCommentSyncJobRepository.findDueByTask as jest.Mock).mockResolvedValue([
      {
        id: 'j-fail',
        direction: 'OUTBOUND',
        commentId: 'c-old',
        payload: { op: 'CREATE' },
        attempts: 2,
      },
    ])
    // Force the drained job's retry to throw
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { commentRepository } =
      await import('@/lib/repositories/comment.repository')
    ;(commentRepository.findById as jest.Mock).mockImplementation(
      (id: string) => {
        if (id === 'c-old') throw new Error('boom')
        return { id: 'c1', taskId: 't1', type: 'USER' }
      }
    )
    const { pullRequestRepository } =
      await import('@/lib/repositories/pull-request.repository')
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(null)

    await prCommentMirrorService.runOutbound('c1', 'CREATE')

    expect(prCommentSyncJobRepository.markDeadLetter).toHaveBeenCalledWith(
      'j-fail',
      'boom'
    )
    errSpy.mockRestore()
  })

  it('a drained job that syncs is deleted and never dead-lettered', async () => {
    ;(prCommentSyncJobRepository.findDueByTask as jest.Mock).mockResolvedValue([
      {
        id: 'j-ok',
        direction: 'OUTBOUND',
        commentId: 'c-gone',
        payload: { op: 'CREATE' },
        attempts: 1,
      },
    ])
    const { commentRepository } =
      await import('@/lib/repositories/comment.repository')
    // The drained comment no longer exists — the retry completes as a no-op.
    ;(commentRepository.findById as jest.Mock).mockImplementation(
      (id: string) =>
        id === 'c-gone' ? null : { id: 'c1', taskId: 't1', type: 'USER' }
    )
    const { pullRequestRepository } =
      await import('@/lib/repositories/pull-request.repository')
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(null)

    await prCommentMirrorService.runOutbound('c1', 'CREATE')

    expect(prCommentSyncJobRepository.delete).toHaveBeenCalledWith('j-ok')
    expect(prCommentSyncJobRepository.markDeadLetter).not.toHaveBeenCalled()
  })

  it('runInbound drains pending INBOUND jobs for the same PR', async () => {
    ;(
      prCommentSyncJobRepository.findDueByPullRequest as jest.Mock
    ).mockResolvedValue([])
    const { prCommentMirrorRepository } =
      await import('@/lib/repositories/pr-comment-mirror.repository')
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
    ).mockResolvedValue(null)

    await prCommentMirrorService.runInbound({
      event: 'issue_comment',
      action: 'deleted',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://...',
          body: null,
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })

    expect(
      prCommentSyncJobRepository.findDueByPullRequest
    ).toHaveBeenCalledWith('pr1', { limit: 10 })
  })
})
