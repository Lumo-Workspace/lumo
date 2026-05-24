/**
 * @jest-environment node
 */
// __tests__/services/pr-comment-mirror/run-outbound-create.test.ts

// Mock heavy transitive deps before any imports
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('app-token'),
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
// Mock Clerk to avoid server-side import issues
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: { getUser: jest.fn().mockResolvedValue({ firstName: 'Someone', lastName: null, emailAddresses: [] }) },
  }),
}))

import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { memberRepository } from '@/lib/repositories/member.repository'

jest.mock('@/lib/integrations/github/pr-comment-client')

const baseComment = {
  id: 'c1',
  taskId: 't1',
  authorActorId: 'a1',
  body: '<p>hello</p>',
  parentId: null,
  type: 'USER',
  deletedAt: null,
}
const basePr = {
  id: 'pr1',
  taskId: 't1',
  repo: 'foo/bar',
  number: 42,
  workspaceId: 'w1',
}

describe('runOutbound CREATE', () => {
  let resolveActorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    const { prCommentSyncJobRepository: sjRepo } = jest.requireMock('@/lib/repositories/pr-comment-sync-job.repository') as typeof import('@/lib/repositories/pr-comment-sync-job.repository')
    ;(sjRepo.findDueByTask as jest.Mock).mockResolvedValue([])
    resolveActorSpy = jest
      .spyOn(prCommentMirrorService, 'resolveOutboundActor')
      .mockResolvedValue({ actor: 'BOT_APP', token: 'tok', userId: null })
    ;(commentRepository.findById as jest.Mock).mockResolvedValue(baseComment)
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(basePr)
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    ;(memberRepository.findByActorId as jest.Mock).mockResolvedValue({
      id: 'm1',
      workspaceId: 'w1',
    })
    ;(prCommentClient.createIssueComment as jest.Mock).mockResolvedValue({
      id: 999,
      node_id: 'IC_x',
      html_url: 'https://github.com/foo/bar/pull/42#issuecomment-999',
      updated_at: '2026-05-24T00:00:00Z',
      body: 'hello',
    })
    ;(prCommentMirrorRepository.reserve as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalId: 'pending-xxx',
    })
  })

  afterEach(() => {
    resolveActorSpy.mockRestore()
  })

  it('reserves a mirror row before calling GitHub', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    const reserveMock = prCommentMirrorRepository.reserve as jest.Mock
    const createMock = prCommentClient.createIssueComment as jest.Mock
    expect(reserveMock).toHaveBeenCalled()
    expect(createMock).toHaveBeenCalled()
    const reserveOrder = reserveMock.mock.invocationCallOrder[0] ?? 0
    const createOrder = createMock.mock.invocationCallOrder[0] ?? 0
    expect(reserveOrder).toBeLessThan(createOrder)
  })

  it('POSTs an issue_comment for a top-level comment', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).toHaveBeenCalledWith({
      repo: { owner: 'foo', name: 'bar' },
      prNumber: 42,
      body: expect.stringContaining('hello'),
      token: 'tok',
    })
  })

  it('patches mirror with real externalId after POST returns', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalledWith(
      'm1',
      {
        externalId: '999',
        externalNodeId: 'IC_x',
        externalUrl: 'https://github.com/foo/bar/pull/42#issuecomment-999',
        externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
      }
    )
  })

  it('no-ops when task has no linked PR', async () => {
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(null)
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).not.toHaveBeenCalled()
  })

  it('no-ops for AGENT comment', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      ...baseComment,
      type: 'AGENT',
    })
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).not.toHaveBeenCalled()
  })

  it('prefixes body with author attribution when actor is BOT_APP', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    const body = (prCommentClient.createIssueComment as jest.Mock).mock
      .calls[0][0].body
    expect(body).toMatch(/在 Lumo 说/)
  })

  it('does not prefix when actor is USER_OAUTH', async () => {
    resolveActorSpy.mockResolvedValue({
      actor: 'USER_OAUTH',
      token: 'tok',
      userId: 'm1',
    })
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    const body = (prCommentClient.createIssueComment as jest.Mock).mock
      .calls[0][0].body
    expect(body).not.toMatch(/在 Lumo 说/)
  })

  it('mirrors unauthored comments (null authorActorId) via BOT_APP instead of silently no-opping', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      authorActorId: null,
      body: '<p>unauthored</p>',
      type: 'USER',
      parentId: null,
    })
    // resolveOutboundActor should NOT be called — no memberForActor lookup path
    resolveActorSpy.mockClear()
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(resolveActorSpy).not.toHaveBeenCalled()
    expect(prCommentClient.createIssueComment).toHaveBeenCalled()
  })

  it('posts as review-line reply when parent is a mirrored REVIEW_LINE', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      ...baseComment,
      parentId: 'parent1',
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        externalSource: 'REVIEW_LINE',
        externalId: '555',
      }
    )
    ;(prCommentClient.createReviewLineReply as jest.Mock).mockResolvedValue({
      id: 1000,
      node_id: 'PRRC_x',
      html_url: 'https://github.com/foo/bar/pull/42#discussion_r1000',
      updated_at: '2026-05-24T00:00:00Z',
      body: 'hello',
    })
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createReviewLineReply).toHaveBeenCalledWith(
      expect.objectContaining({ inReplyTo: 555 })
    )
  })
})
