/**
 * @jest-environment node
 */
// __tests__/services/pr-comment-mirror/run-inbound-create.test.ts

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
jest.mock('@/lib/services/github-actor.service')
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
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: {
      findUnique: jest.fn(),
    },
    task: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}))

import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

describe('runInbound CREATE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(
      prCommentSyncJobRepository.findDueByPullRequest as jest.Mock
    ).mockResolvedValue([])
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
    ).mockResolvedValue(null)
    jest
      .spyOn(prCommentMirrorService, 'resolveInboundAuthor')
      .mockResolvedValue({ actorId: 'mapped-actor' })
    ;(commentRepository.create as jest.Mock).mockResolvedValue({ id: 'c-new' })
  })

  it('creates a Comment then a PrCommentMirror sequentially for an ISSUE event', async () => {
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
          body: 'hello',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        authorActorId: 'mapped-actor',
        body: expect.stringContaining('hello'),
        parentId: null,
      })
    )
    expect(prCommentMirrorRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: 'c-new',
        pullRequestId: 'pr1',
        externalSource: 'ISSUE',
        externalId: '999',
      })
    )
  })

  it('renders REVIEW_LINE header with file path + line linking out to comment URL', async () => {
    await prCommentMirrorService.runInbound({
      event: 'pull_request_review_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 1000,
          node_id: 'PRRC_x',
          html_url: 'https://github.com/foo/bar/pull/1#discussion_r1000',
          body: 'nit: rename',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
          path: 'src/foo.ts',
          line: 42,
          start_line: null,
          side: 'RIGHT',
        },
      },
    })
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('src/foo.ts:42'),
      })
    )
  })

  it('renders REVIEW header with state icon for Approved/Changes/Commented', async () => {
    await prCommentMirrorService.runInbound({
      event: 'pull_request_review',
      action: 'submitted',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        review: {
          id: 700,
          node_id: 'PRR_x',
          html_url: 'https://...',
          body: 'looks good',
          submitted_at: '2026-05-24T00:00:00Z',
          updated_at: '2026-05-24T00:00:00Z',
          state: 'approved',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Approved'),
      })
    )
  })

  it('resolves parent via in_reply_to_id when present', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockImplementation(
      async (_source: string, externalId: string) =>
        externalId === '555' ? { commentId: 'parent-comment' } : null
    )
    await prCommentMirrorService.runInbound({
      event: 'pull_request_review_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 1001,
          node_id: 'PRRC_y',
          html_url: 'https://...',
          body: 'reply',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
          path: 'src/foo.ts',
          line: 42,
          in_reply_to_id: 555,
        },
      },
    })
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'parent-comment' })
    )
  })

  it('schedules a delayed retry job when parent mirror is missing', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockImplementation(
      async (_source: string, _externalId: string) => null // parent missing
    )
    const { prCommentSyncJobRepository } =
      await import('@/lib/repositories/pr-comment-sync-job.repository')
    jest
      .spyOn(prCommentSyncJobRepository, 'enqueue')
      .mockResolvedValue({} as any)
    await prCommentMirrorService.runInbound({
      event: 'pull_request_review_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 1001,
          node_id: 'PRRC_y',
          html_url: 'https://...',
          body: 'reply',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
          path: 'src/foo.ts',
          line: 42,
          in_reply_to_id: 555,
        },
      },
    })
    // Top-level created + delayed retry queued
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: null })
    )
    expect(prCommentSyncJobRepository.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'INBOUND',
        scheduledFor: expect.any(Date),
        payload: expect.objectContaining({
          pullRequestId: 'pr1',
        }),
      })
    )
  })
})
