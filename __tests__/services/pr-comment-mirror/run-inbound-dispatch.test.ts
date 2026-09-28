/**
 * @jest-environment node
 */
// __tests__/services/pr-comment-mirror/run-inbound-dispatch.test.ts

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
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { githubActorService } from '@/lib/services/github-actor.service'
import { githubRepository } from '@/lib/repositories/github.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

const baseEnv = {
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
}

const issuePayload = {
  event: 'issue_comment' as const,
  action: 'created' as const,
  ...baseEnv,
  raw: {
    comment: {
      id: 999,
      node_id: 'IC_x',
      html_url: 'https://github.com/foo/bar/pull/1#issuecomment-999',
      body: 'hello',
      updated_at: '2026-05-24T00:00:00Z',
      user: {
        id: 12345,
        login: 'foo',
        type: 'User',
        avatar_url: 'https://...',
      },
    },
    repository: { full_name: 'foo/bar' },
  },
}

describe('runInbound dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(
      prCommentSyncJobRepository.findDueByPullRequest as jest.Mock
    ).mockResolvedValue([])
  })

  it('drops echo when matching mirror has externalUpdatedAt >= payload.updated_at', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
    })
    await prCommentMirrorService.runInbound(issuePayload)
    expect(githubActorService.upsertPseudoActor).not.toHaveBeenCalled()
  })

  it('falls back to placeholder lookup when no exact mirror match', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
    ).mockResolvedValue({
      id: 'm-placeholder',
      externalId: 'pending-xxx',
    })
    await prCommentMirrorService.runInbound(issuePayload)
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalledWith(
      'm-placeholder',
      expect.objectContaining({ externalId: '999' })
    )
  })

  it('resolves author to mapped Lumo member when GitHub login matches integration', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
    ).mockResolvedValue(null)
    ;(githubRepository.findIntegrationByLogin as jest.Mock).mockResolvedValue({
      member: { actor: { id: 'mapped-actor' } },
    })

    // Spy on internal write path - we test concrete behavior in Task 13
    // Here we assert the author resolution returns the mapped actor id
    const r = await prCommentMirrorService.resolveInboundAuthor(
      'w1',
      issuePayload.raw.comment.user
    )
    expect(r?.actorId).toBe('mapped-actor')
  })

  it('creates GITHUB_USER pseudo actor when no integration matches', async () => {
    ;(githubRepository.findIntegrationByLogin as jest.Mock).mockResolvedValue(
      null
    )
    ;(githubActorService.upsertPseudoActor as jest.Mock).mockResolvedValue({
      id: 'pseudo-actor',
    })
    const r = await prCommentMirrorService.resolveInboundAuthor(
      'w1',
      issuePayload.raw.comment.user
    )
    expect(r?.actorId).toBe('pseudo-actor')
    expect(githubActorService.upsertPseudoActor).toHaveBeenCalled()
  })

  it('skips when GitHub user is the configured BOT login', async () => {
    const r = await prCommentMirrorService.resolveInboundAuthor('w1', {
      id: 1,
      login: 'lumo-app[bot]',
      type: 'Bot',
      avatar_url: '',
    })
    expect(r).toBeNull()
  })
})
