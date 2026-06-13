import { actorRepository } from '@/lib/repositories/actor.repository'

const mockActorFindUnique = jest.fn()
const mockActorCreate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: {
      findUnique: (...args: any[]) => mockActorFindUnique(...args),
      create: (...args: any[]) => mockActorCreate(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('actorRepository', () => {
  describe('findByExternalIdentity', () => {
    it('looks up the actor by the workspace + externalIdentity composite key', async () => {
      mockActorFindUnique.mockResolvedValue({ id: 'a-1' })

      const result = await actorRepository.findByExternalIdentity(
        'ws-1',
        'github:octocat'
      )

      expect(result).toEqual({ id: 'a-1' })
      expect(mockActorFindUnique).toHaveBeenCalledWith({
        where: {
          workspaceId_externalIdentity: {
            workspaceId: 'ws-1',
            externalIdentity: 'github:octocat',
          },
        },
      })
    })

    it('returns null when no actor matches', async () => {
      mockActorFindUnique.mockResolvedValue(null)

      const result = await actorRepository.findByExternalIdentity(
        'ws-1',
        'github:ghost'
      )

      expect(result).toBeNull()
    })
  })

  describe('createPseudoActor', () => {
    it('creates a GITHUB_USER actor with the external identity and avatar', async () => {
      mockActorCreate.mockResolvedValue({ id: 'a-2' })

      const result = await actorRepository.createPseudoActor({
        workspaceId: 'ws-1',
        externalIdentity: 'github:octocat',
        externalAvatarUrl: 'https://avatars/octocat.png',
      })

      expect(result).toEqual({ id: 'a-2' })
      expect(mockActorCreate).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          type: 'GITHUB_USER',
          externalIdentity: 'github:octocat',
          externalAvatarUrl: 'https://avatars/octocat.png',
        },
      })
    })
  })
})
