/**
 * @jest-environment node
 */
// LUM-1027 — Better Auth user directory specifics (getUser / updateUser
// semantics are in user-directory.conformance.test.ts).
const mockRepo = {
  findById: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
}
jest.mock('@/lib/repositories/auth-user.repository', () => ({
  authUserRepository: {
    findById: (...a: unknown[]) => mockRepo.findById(...a),
    findMany: (...a: unknown[]) => mockRepo.findMany(...a),
    update: (...a: unknown[]) => mockRepo.update(...a),
  },
}))
const mockPut = jest.fn()
jest.mock('@/lib/blob/storage', () => ({
  getBlobStorage: async () => ({ put: (...a: unknown[]) => mockPut(...a) }),
}))

import {
  DEFAULT_USER_LIST_LIMIT,
  MAX_USER_LIST_LIMIT,
  betterAuthUserDirectory as dir,
} from '@/lib/auth/better-auth/users'

const ada = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@x.io',
  emailVerified: true,
  image: null,
  firstName: 'Ada',
  lastName: 'Lovelace',
}

beforeEach(() => jest.resetAllMocks())

describe('betterAuthUserDirectory', () => {
  it('getUserList passes ids/emails and clamps the limit like Clerk', async () => {
    mockRepo.findMany.mockResolvedValue([ada])
    await expect(
      dir.getUserList({ userId: ['u1', 'gone'], emailAddress: ['A@X.io'] })
    ).resolves.toMatchObject({ data: [{ id: 'u1' }] })
    expect(mockRepo.findMany).toHaveBeenLastCalledWith({
      ids: ['u1', 'gone'],
      emails: ['A@X.io'],
      limit: DEFAULT_USER_LIST_LIMIT,
    })
    await dir.getUserList({ userId: ['u1'], limit: 10_000 })
    expect(mockRepo.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: MAX_USER_LIST_LIMIT })
    )
  })

  it('updateUserProfileImage stores a public blob and saves its URL', async () => {
    mockRepo.findById.mockResolvedValue(ada)
    mockPut.mockResolvedValue({
      url: 'https://blob/avatars/u1/a.png',
      pathname: 'x',
    })
    mockRepo.update.mockImplementation(async (_id, data) => ({
      ...ada,
      ...data,
    }))
    const file = new File(['png'], 'a.png', { type: 'image/png' })
    const out = await dir.updateUserProfileImage('u1', { file })
    expect(mockPut).toHaveBeenCalledWith('avatars/u1/avatar.png', file, {
      access: 'public',
      contentType: 'image/png',
      addRandomSuffix: true,
    })
    expect(mockRepo.update).toHaveBeenCalledWith('u1', {
      image: 'https://blob/avatars/u1/a.png',
    })
    expect(out).toMatchObject({ imageUrl: 'https://blob/avatars/u1/a.png' })
  })
})
