/**
 * @jest-environment node
 */
// __tests__/services/pr-comment-mirror/run-inbound-update-conflict.test.ts

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
    $transaction: jest.fn(async (cb: (tx: object) => unknown) => cb({})),
  },
}))

import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

const baseExisting = {
  id: 'm1',
  commentId: 'c1',
  externalSource: 'ISSUE',
  externalId: '999',
  externalUpdatedAt: new Date('2026-05-24T01:00:00Z'),
}

const basePayload = (updatedAt: string, body = 'remote edit') => ({
  event: 'issue_comment' as const,
  action: 'edited' as const,
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
  raw: {
    comment: {
      id: 999,
      node_id: 'IC_x',
      html_url: 'https://...',
      body,
      updated_at: updatedAt,
      user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
    },
  },
})

describe('runInbound UPDATE — conflict matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(
      prCommentSyncJobRepository.findDueByPullRequest as jest.Mock
    ).mockResolvedValue([])
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      baseExisting
    )
  })

  it('T <= M → echo drop (no update, no outbound)', async () => {
    await prCommentMirrorService.runInbound(basePayload('2026-05-24T01:00:00Z'))
    expect(commentRepository.update).not.toHaveBeenCalled()
    expect(prCommentSyncJobRepository.enqueue).not.toHaveBeenCalled()
  })

  it('L <= M → apply inbound (no local edits since last sync)', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      updatedAt: new Date('2026-05-24T00:30:00Z'), // L < M
      body: '<p>original</p>',
      deletedAt: null,
    })
    await prCommentMirrorService.runInbound(basePayload('2026-05-24T02:00:00Z'))
    expect(commentRepository.update).toHaveBeenCalledWith(
      'c1',
      expect.any(Object)
    )
    expect(prCommentMirrorRepository.patchAfterEdit).toHaveBeenCalled()
  })

  it('M < L < T → GH wins (apply inbound, log conflict)', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      updatedAt: new Date('2026-05-24T01:30:00Z'), // M < L < T
      body: '<p>local edit</p>',
      deletedAt: null,
    })
    const logSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await prCommentMirrorService.runInbound(basePayload('2026-05-24T02:00:00Z'))
    expect(commentRepository.update).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('pr-mirror conflict'),
      expect.any(Object)
    )
    logSpy.mockRestore()
  })

  it('M < T < L → local wins (schedule outbound, no local mutation)', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      updatedAt: new Date('2026-05-24T03:00:00Z'), // L > T > M
      body: '<p>local edit</p>',
      deletedAt: null,
    })
    await prCommentMirrorService.runInbound(basePayload('2026-05-24T02:00:00Z'))
    expect(commentRepository.update).not.toHaveBeenCalled()
    expect(prCommentSyncJobRepository.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUTBOUND',
        payload: { op: 'UPDATE', mirrorId: 'm1' },
      })
    )
  })
})
