/**
 * @jest-environment node
 *
 * LUM-925 — a PR linked to tasks in more than one workspace was linked by
 * branch name alone, and at most one of those tasks really owns it. Lumo
 * comments must not be posted or edited on it (they would publish one
 * workspace's discussion on another's PR); deleting an already-leaked mirror
 * still goes through.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('app-token'),
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')
jest.mock('@/lib/repositories/member.repository')
jest.mock('@/lib/integrations/github/pr-comment-client')
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForComment: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByUserAndWorkspace: jest.fn(),
    findIntegrationByLogin: jest.fn(),
  },
}))
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: { getUser: jest.fn() },
  }),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'

const countLinked = pullRequestRepository.countTaskLinkedWorkspaces as jest.Mock
const client = prCommentClient as unknown as Record<string, jest.Mock>

const PR = {
  id: 'pr-b',
  taskId: 'task-b',
  repo: 'acme-inc/web',
  number: 7,
  workspaceId: 'w-b',
}
const LEAKED_MIRROR = {
  id: 'mirror-1',
  commentId: 'c1',
  externalId: '999',
  externalSource: 'ISSUE',
  outboundActor: 'BOT_APP',
  inReplyToExternalId: null,
  lastSyncedAt: new Date('2026-09-30T00:00:00Z'),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(prCommentSyncJobRepository.findDueByTask as jest.Mock).mockResolvedValue([])
  ;(commentRepository.findById as jest.Mock).mockResolvedValue({
    id: 'c1',
    taskId: 'task-b',
    authorActorId: null,
    body: '<p>internal discussion</p>',
    parentId: null,
    type: 'USER',
    deletedAt: null,
  })
  ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(PR)
  ;(prCommentMirrorRepository.reserve as jest.Mock).mockResolvedValue({
    id: 'mirror-new',
    externalId: 'pending-x',
  })
  client.createIssueComment!.mockResolvedValue({
    id: 1000,
    node_id: 'IC_y',
    html_url: 'https://github.com/acme-inc/web/pull/7#issuecomment-1000',
    updated_at: '2026-10-01T00:00:00Z',
  })
  client.updateIssueComment!.mockResolvedValue({
    updated_at: '2026-10-01T00:00:00Z',
  })
  client.deleteIssueComment!.mockResolvedValue(undefined)
})

describe('LUM-925 outbound mirror on a PR shared across workspaces', () => {
  it('LUM-925 outbound mirror skips a PR linked in several workspaces', async () => {
    countLinked.mockResolvedValue(2)

    // A new comment is not posted.
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(countLinked).toHaveBeenCalledWith('acme-inc/web', 7)
    expect(client.createIssueComment).not.toHaveBeenCalled()
    expect(client.createReviewLineReply).not.toHaveBeenCalled()
    expect(prCommentMirrorRepository.reserve).not.toHaveBeenCalled()

    // A comment that already leaked is not edited either…
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      LEAKED_MIRROR
    )
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(client.updateIssueComment).not.toHaveBeenCalled()
    expect(client.updateReviewLineComment).not.toHaveBeenCalled()

    // …but deleting it still removes it from GitHub.
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(client.deleteIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '999' })
    )
    expect(prCommentMirrorRepository.markDeleted).toHaveBeenCalledWith(
      'mirror-1'
    )
  })

  it('still posts when only this workspace has the PR linked', async () => {
    countLinked.mockResolvedValue(1)
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(client.createIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 7 })
    )
  })
})
