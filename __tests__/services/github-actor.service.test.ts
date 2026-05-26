import { githubActorService } from '@/lib/services/github-actor.service'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: { findUnique: jest.fn(), create: jest.fn() },
  },
}))

describe('githubActorService.upsertPseudoActor', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns existing actor when externalIdentity already exists', async () => {
    ;(prisma.actor.findUnique as jest.Mock).mockResolvedValue({
      id: 'a1',
      externalIdentity: 'github:foo',
    })
    const r = await githubActorService.upsertPseudoActor('w1', {
      id: 12345,
      login: 'foo',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
    })
    expect(r.id).toBe('a1')
    expect(prisma.actor.create).not.toHaveBeenCalled()
  })

  it('creates a GITHUB_USER actor when none exists', async () => {
    ;(prisma.actor.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.actor.create as jest.Mock).mockResolvedValue({ id: 'a2' })
    await githubActorService.upsertPseudoActor('w1', {
      id: 12345,
      login: 'foo',
      avatar_url: 'https://example.com/avatar.png',
    })
    expect(prisma.actor.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'w1',
        type: 'GITHUB_USER',
        externalIdentity: 'github:foo',
        externalAvatarUrl: 'https://example.com/avatar.png',
      },
    })
  })
})
