/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { actorRepository } from '@/lib/repositories/actor.repository'

const mockFindMany = prisma.actor.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('actorRepository.findGithubIdentitiesByIds', () => {
  it('short-circuits to [] for an empty id list', async () => {
    const r = await actorRepository.findGithubIdentitiesByIds([])
    expect(r).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('queries GITHUB_USER actors by id and returns id + externalIdentity', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'act_1', externalIdentity: 'github:octocat' },
    ])
    const r = await actorRepository.findGithubIdentitiesByIds(['act_1', 'act_2'])
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['act_1', 'act_2'] }, type: 'GITHUB_USER' },
      select: { id: true, externalIdentity: true },
    })
    expect(r).toEqual([{ id: 'act_1', externalIdentity: 'github:octocat' }])
  })
})
