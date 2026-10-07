/**
 * @jest-environment node
 */
// LUM-1027 — query shapes of the auth_users repository (the real-database
// round trip is covered by __tests__/integration/better-auth.flow.test.ts).
const mockAuthUser = {
  findUnique: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
}
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    authUser: {
      findUnique: (...a: unknown[]) => mockAuthUser.findUnique(...a),
      findMany: (...a: unknown[]) => mockAuthUser.findMany(...a),
      update: (...a: unknown[]) => mockAuthUser.update(...a),
    },
  },
}))

import { authUserRepository } from '@/lib/repositories/auth-user.repository'

const SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  firstName: true,
  lastName: true,
}

beforeEach(() => jest.resetAllMocks())

describe('authUserRepository', () => {
  it('findById selects only the directory columns (never password rows)', async () => {
    mockAuthUser.findUnique.mockResolvedValue(null)
    await authUserRepository.findById('u1')
    expect(mockAuthUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: SELECT,
    })
  })

  it('findMany ORs ids and case-insensitive emails, capped at limit', async () => {
    mockAuthUser.findMany.mockResolvedValue([])
    await authUserRepository.findMany({
      ids: ['u1'],
      emails: ['A@x.io'],
      limit: 5,
    })
    expect(mockAuthUser.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { id: { in: ['u1'] } },
          { email: { equals: 'A@x.io', mode: 'insensitive' } },
        ],
      },
      select: SELECT,
      orderBy: { createdAt: 'asc' },
      take: 5,
    })
  })

  it('findMany with only empty filters returns [] without querying', async () => {
    await expect(
      authUserRepository.findMany({ ids: [], emails: [], limit: 5 })
    ).resolves.toEqual([])
    expect(mockAuthUser.findMany).not.toHaveBeenCalled()
  })

  it('findMany with no filter at all lists the first page', async () => {
    mockAuthUser.findMany.mockResolvedValue([])
    await authUserRepository.findMany({ limit: 10 })
    expect(mockAuthUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 10 })
    )
  })

  it('update writes the given fields and returns the selected row', async () => {
    mockAuthUser.update.mockResolvedValue({ id: 'u1' })
    await authUserRepository.update('u1', { image: 'https://x' })
    expect(mockAuthUser.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { image: 'https://x' },
      select: SELECT,
    })
  })
})
