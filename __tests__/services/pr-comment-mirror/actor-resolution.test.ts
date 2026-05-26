/**
 * @jest-environment node
 */
import {
  prCommentMirrorService,
  _clearWriteCacheForTesting,
} from '@/lib/services/pr-comment-mirror.service'
import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: { findIntegrationByUserAndWorkspace: jest.fn() },
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('app-token'),
}))

// canWriteRepo uses fetch
const fetchMock = jest.fn()
beforeEach(() => {
  global.fetch = fetchMock
  jest.clearAllMocks()
  _clearWriteCacheForTesting()
})

describe('resolveOutboundActor', () => {
  it('returns USER_OAUTH when user has integration with push perm', async () => {
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue({ accessToken: 'enc', githubLogin: 'foo' })
    ;(decrypt as jest.Mock).mockReturnValue('user-token')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ permissions: { push: true } }), {
        status: 200,
      })
    )

    const r = await prCommentMirrorService.resolveOutboundActor({
      workspaceId: 'w1',
      authorUserId: 'm1',
      repo: { owner: 'o', name: 'r' },
    })
    expect(r.actor).toBe('USER_OAUTH')
    expect(r.token).toBe('user-token')
    expect(r.userId).toBe('m1')
  })

  it('falls back to BOT_APP when user lacks push perm', async () => {
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue({ accessToken: 'enc', githubLogin: 'foo' })
    ;(decrypt as jest.Mock).mockReturnValue('user-token')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ permissions: { push: false } }), {
        status: 200,
      })
    )

    const r = await prCommentMirrorService.resolveOutboundActor({
      workspaceId: 'w1',
      authorUserId: 'm1',
      repo: { owner: 'o', name: 'r' },
    })
    expect(r.actor).toBe('BOT_APP')
    expect(r.token).toBe('app-token')
  })

  it('falls back to BOT_APP when no integration', async () => {
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue(null)
    const r = await prCommentMirrorService.resolveOutboundActor({
      workspaceId: 'w1',
      authorUserId: 'm1',
      repo: { owner: 'o', name: 'r' },
    })
    expect(r.actor).toBe('BOT_APP')
  })

  it('two users with similar token prefix do not share cache results', async () => {
    // Both users have tokens starting with 'gho_' (only 4 real entropy chars after prefix).
    // Old key was token.slice(0,8)+':'+repo — both would map to same key.
    // New key is userId+':'+repo — they must be independent.
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue({ accessToken: 'enc', githubLogin: 'any' })
    ;(decrypt as jest.Mock).mockReturnValue('gho_abc1234')

    // User m1 has push access
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ permissions: { push: true } }), {
        status: 200,
      })
    )
    const r1 = await prCommentMirrorService.resolveOutboundActor({
      workspaceId: 'w1',
      authorUserId: 'm1',
      repo: { owner: 'o', name: 'r' },
    })
    expect(r1.actor).toBe('USER_OAUTH')

    // User m2 has NO push access (different fetch response)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ permissions: { push: false } }), {
        status: 200,
      })
    )
    const r2 = await prCommentMirrorService.resolveOutboundActor({
      workspaceId: 'w1',
      authorUserId: 'm2',
      repo: { owner: 'o', name: 'r' },
    })
    // m2 must NOT get USER_OAUTH from m1's cached entry
    expect(r2.actor).toBe('BOT_APP')
  })
})
