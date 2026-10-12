/**
 * @jest-environment node
 *
 * LUM-1103 — `findMemberByEmail` resolves the Slack caller's member with a
 * constant number of user-directory calls (a batch `getUserList` by id per
 * 500 members), never one `getUser` per member.
 */

const mockListActiveMembers = jest.fn()
jest.mock('@/lib/repositories/slack-command.repository', () => ({
  slackCommandRepository: {
    listActiveMembers: (...a: unknown[]) => mockListActiveMembers(...a),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {},
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {},
}))

interface FakeUser {
  id: string
  firstName: string | null
  lastName: string | null
  username: string | null
  imageUrl: string
  primaryEmailAddressId: string | null
  emailAddresses: { id: string; emailAddress: string }[]
}

let mockUsers: Map<string, FakeUser>
const mockGetUser = jest.fn(async (id: string) => {
  const u = mockUsers.get(id)
  if (!u) throw Object.assign(new Error('not found'), { status: 404 })
  return u
})
const mockGetUserList = jest.fn(
  async ({ userId = [] }: { userId?: string[]; limit?: number }) => ({
    data: userId.flatMap(id => {
      const u = mockUsers.get(id)
      return u ? [u] : []
    }),
  })
)
jest.mock('@/lib/auth/users', () => ({
  createUserDirectory: async () => ({
    getUser: (id: string) => mockGetUser(id),
    getUserList: (q: { userId?: string[]; limit?: number }) =>
      mockGetUserList(q),
  }),
}))

import { slackCommandService } from '@/lib/services/slack-command.service'

function user(
  id: string,
  email: string,
  extra: Partial<FakeUser> = {}
): FakeUser {
  return {
    id,
    firstName: null,
    lastName: null,
    username: null,
    imageUrl: '',
    primaryEmailAddressId: `em_${id}`,
    emailAddresses: [{ id: `em_${id}`, emailAddress: email }],
    ...extra,
  }
}

function seed(count: number) {
  const members = Array.from({ length: count }, (_, i) => ({
    id: `wm_${i}`,
    clerkId: `user_${i}`,
    actor: { id: `actor_${i}` },
  }))
  mockUsers = new Map(
    members.map((m, i) => [
      m.clerkId,
      user(m.clerkId, `person${i}@example.com`, { firstName: `P${i}` }),
    ])
  )
  mockListActiveMembers.mockResolvedValue(members)
  return members
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUsers = new Map()
})

describe('slackCommandService.findMemberByEmail — directory call count', () => {
  it('makes one batch directory call for 50 members, no per-member getUser', async () => {
    seed(50)
    const found = await slackCommandService.findMemberByEmail(
      'ws_1',
      'person49@example.com'
    )
    expect(found?.memberId).toBe('wm_49')
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockGetUserList).toHaveBeenCalledTimes(1)
    const query = mockGetUserList.mock.calls[0]![0]
    expect(query.userId).toHaveLength(50)
    expect(query.limit).toBe(50)
  })

  it('keeps the call count independent of the member count (5 vs 200)', async () => {
    seed(5)
    await slackCommandService.findMemberByEmail('ws_1', 'nobody@example.com')
    const small = mockGetUserList.mock.calls.length
    jest.clearAllMocks()
    seed(200)
    await slackCommandService.findMemberByEmail('ws_1', 'nobody@example.com')
    expect(mockGetUserList.mock.calls.length).toBe(small)
    expect(small).toBe(1)
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('pages ids in chunks of 500 (the getUserList cap)', async () => {
    seed(1001)
    const found = await slackCommandService.findMemberByEmail(
      'ws_1',
      'person1000@example.com'
    )
    expect(found?.memberId).toBe('wm_1000')
    expect(mockGetUserList).toHaveBeenCalledTimes(3)
    expect(mockGetUserList.mock.calls.map(c => c[0].userId?.length)).toEqual([
      500, 500, 1,
    ])
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('makes no directory call when the workspace has no active members', async () => {
    mockListActiveMembers.mockResolvedValue([])
    expect(
      await slackCommandService.findMemberByEmail('ws_1', 'a@example.com')
    ).toBeNull()
    expect(mockGetUserList).not.toHaveBeenCalled()
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})

describe('slackCommandService.findMemberByEmail — match semantics unchanged', () => {
  it('matches the primary email case-insensitively and trims input', async () => {
    mockListActiveMembers.mockResolvedValue([
      { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
    ])
    mockUsers = new Map([
      [
        'user_1',
        user('user_1', 'Dev.Person@Example.com', {
          firstName: 'Dev',
          lastName: 'Person',
        }),
      ],
    ])
    expect(
      await slackCommandService.findMemberByEmail(
        'ws_1',
        '  DEV.PERSON@example.COM '
      )
    ).toEqual({
      memberId: 'wm_1',
      clerkId: 'user_1',
      actorId: 'actor_1',
      name: 'Dev Person',
    })
  })

  it('ignores a matching non-primary email', async () => {
    mockListActiveMembers.mockResolvedValue([
      { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
    ])
    mockUsers = new Map([
      [
        'user_1',
        user('user_1', 'primary@example.com', {
          emailAddresses: [
            { id: 'em_user_1', emailAddress: 'primary@example.com' },
            { id: 'em_other', emailAddress: 'alt@example.com' },
          ],
        }),
      ],
    ])
    expect(
      await slackCommandService.findMemberByEmail('ws_1', 'alt@example.com')
    ).toBeNull()
  })

  it('returns the first member in member order when two share an email', async () => {
    mockListActiveMembers.mockResolvedValue([
      { id: 'wm_b', clerkId: 'user_b', actor: null },
      { id: 'wm_a', clerkId: 'user_a', actor: { id: 'actor_a' } },
    ])
    // Directory returns them in the opposite order.
    mockUsers = new Map([
      ['user_a', user('user_a', 'same@example.com', { username: 'aa' })],
      ['user_b', user('user_b', 'same@example.com', { username: 'bb' })],
    ])
    const found = await slackCommandService.findMemberByEmail(
      'ws_1',
      'same@example.com'
    )
    expect(found).toEqual({
      memberId: 'wm_b',
      clerkId: 'user_b',
      actorId: null,
      name: 'bb',
    })
  })

  it('skips a member whose directory user no longer exists', async () => {
    mockListActiveMembers.mockResolvedValue([
      { id: 'wm_gone', clerkId: 'user_gone', actor: { id: 'actor_gone' } },
      { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
    ])
    mockUsers = new Map([['user_1', user('user_1', 'dev@example.com')]])
    const found = await slackCommandService.findMemberByEmail(
      'ws_1',
      'dev@example.com'
    )
    expect(found?.memberId).toBe('wm_1')
    expect(found?.name).toBe('dev')
  })
})
