/**
 * @jest-environment node
 */
// __tests__/services/pr-comment-mirror/run-outbound-create.test.ts

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
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegrationByUserAndWorkspace: jest.fn(),
    findIntegrationByLogin: jest.fn(),
  },
}))
// Mock Clerk to avoid server-side import issues
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
  beforeEach(() => {
    jest.clearAllMocks()
    const { prCommentSyncJobRepository: sjRepo } = jest.requireMock(
      '@/lib/repositories/pr-comment-sync-job.repository'
    ) as typeof import('@/lib/repositories/pr-comment-sync-job.repository')
    ;(sjRepo.findDueByTask as jest.Mock).mockResolvedValue([])
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
      token: 'app-token',
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

  it('prefixes body with author attribution (the App cannot speak as a person)', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    const body = (prCommentClient.createIssueComment as jest.Mock).mock
      .calls[0][0].body
    expect(body).toMatch(/在 Lumo 说/)
  })

  it('posts as the App installation, never as a member token', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'app-token' })
    )
  })

  it('mirrors unauthored comments (null authorActorId) instead of silently no-opping', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      authorActorId: null,
      body: '<p>unauthored</p>',
      type: 'USER',
      parentId: null,
    })
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).toHaveBeenCalled()
  })

  it('posts as review-line reply when parent is a mirrored REVIEW_LINE', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      ...baseComment,
      parentId: 'parent1',
    })
    // First call: own mirror check (null — no prior attempt)
    // Second call: parent mirror check (REVIEW_LINE)
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        externalSource: 'REVIEW_LINE',
        externalId: '555',
      })
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

  it('prefixes body with a real comment URL when actor is BOT_APP', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    const body = (prCommentClient.createIssueComment as jest.Mock).mock
      .calls[0][0].body as string
    expect(body).toMatch(
      /https:\/\/app\.lumo\.dev\/workspace\/my-workspace\/tasks\/LUM-10#comment-c1/
    )
  })
})

describe('runOutbound CREATE — retry idempotency', () => {
  // The pending body is the same attribution-prefixed markdown every outbound
  // comment carries; the list-and-match hash is computed over it with an empty
  // comment url, so the fixture below must match that shape exactly.
  const PENDING_BODY = '**[Someone]() 在 Lumo 说：**\n\nhello'

  const pendingMirror = {
    id: 'm-existing',
    externalId: 'pending-abc123',
    externalSource: 'ISSUE' as const,
    outboundActor: 'BOT_APP' as const,
    outboundActorUserId: null,
    inReplyToExternalId: null,
    lastSyncedAt: new Date('2026-05-24T00:00:00Z'),
    bodyHash: '',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    const { prCommentSyncJobRepository: sjRepo } = jest.requireMock(
      '@/lib/repositories/pr-comment-sync-job.repository'
    ) as typeof import('@/lib/repositories/pr-comment-sync-job.repository')
    ;(sjRepo.findDueByTask as jest.Mock).mockResolvedValue([])
    ;(commentRepository.findById as jest.Mock).mockResolvedValue(baseComment)
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(basePr)
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

  it('non-pending existing mirror → no-op (already created)', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        ...pendingMirror,
        externalId: '999', // real id, not pending
      }
    )
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).not.toHaveBeenCalled()
    expect(prCommentMirrorRepository.reserve).not.toHaveBeenCalled()
  })

  it('pending mirror + GH list matches body hash → no re-POST, resolvePlaceholder called with all matched fields', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      pendingMirror
    )
    ;(prCommentClient.listIssueCommentsSince as jest.Mock).mockResolvedValue([
      {
        id: 777,
        node_id: 'IC_777',
        html_url: 'https://github.com/foo/bar/pull/42#issuecomment-777',
        body: PENDING_BODY,
        updated_at: '2026-05-24T01:23:45Z',
        user: { id: 1 },
      },
    ])
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).not.toHaveBeenCalled()
    // Critical: every GH-provided field is propagated, not synthesized blanks.
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalledWith(
      'm-existing',
      {
        externalId: '777',
        externalNodeId: 'IC_777',
        externalUrl: 'https://github.com/foo/bar/pull/42#issuecomment-777',
        externalUpdatedAt: new Date('2026-05-24T01:23:45Z'),
      }
    )
  })

  it('REVIEW_LINE pending mirror routes through listReviewCommentsSince, not listIssueCommentsSince', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        ...pendingMirror,
        externalSource: 'REVIEW_LINE' as const,
        inReplyToExternalId: '555',
      }
    )
    ;(prCommentClient.listReviewCommentsSince as jest.Mock).mockResolvedValue([
      {
        id: 1010,
        node_id: 'PRRC_1010',
        html_url: 'https://github.com/foo/bar/pull/42#discussion_r1010',
        body: PENDING_BODY,
        updated_at: '2026-05-24T02:00:00Z',
        user: { id: 1 },
      },
    ])
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.listReviewCommentsSince).toHaveBeenCalled()
    expect(prCommentClient.listIssueCommentsSince).not.toHaveBeenCalled()
    expect(prCommentClient.createReviewLineReply).not.toHaveBeenCalled()
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalledWith(
      'm-existing',
      {
        externalId: '1010',
        externalNodeId: 'PRRC_1010',
        externalUrl: 'https://github.com/foo/bar/pull/42#discussion_r1010',
        externalUpdatedAt: new Date('2026-05-24T02:00:00Z'),
      }
    )
  })

  it('pending mirror + GH list returns no match → re-POST, resolvePlaceholder called', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      pendingMirror
    )
    // listIssueCommentsSince returns nothing matching
    ;(prCommentClient.listIssueCommentsSince as jest.Mock).mockResolvedValue([])
    ;(prCommentClient.createIssueComment as jest.Mock).mockResolvedValue({
      id: 888,
      node_id: 'IC_y',
      html_url: 'https://github.com/foo/bar/pull/42#issuecomment-888',
      updated_at: '2026-05-24T00:00:00Z',
      body: 'hello',
    })
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).toHaveBeenCalled()
    expect(prCommentMirrorRepository.reserve).not.toHaveBeenCalled()
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalledWith(
      'm-existing',
      expect.objectContaining({ externalId: '888' })
    )
  })
})
