/**
 * @jest-environment node
 */
// __tests__/services/pr-comment-mirror/run-inbound-delete.test.ts

// Mock heavy transitive deps before any imports
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('app-token'),
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/repositories/member.repository')
jest.mock('@/lib/db/prisma', () => ({ prisma: { $transaction: jest.fn() } }))
jest.mock('@/lib/services/github-actor.service')
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByUserAndWorkspace: jest.fn(),
    findIntegrationByLogin: jest.fn(),
  },
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
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

describe('runInbound DELETE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(
      prCommentSyncJobRepository.findDueByPullRequest as jest.Mock
    ).mockResolvedValue([])
  })

  it('soft-deletes the local comment and marks mirror deletedAt', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue({
      id: 'm1',
      commentId: 'c1',
      externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
    })
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
          updated_at: '2026-05-24T02:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    expect(commentRepository.delete).toHaveBeenCalledWith('c1')
    expect(prCommentMirrorRepository.markDeleted).toHaveBeenCalledWith('m1')
  })

  it('is a no-op when mirror missing (unknown comment)', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
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
          updated_at: '2026-05-24T02:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    expect(commentRepository.delete).not.toHaveBeenCalled()
  })
})
