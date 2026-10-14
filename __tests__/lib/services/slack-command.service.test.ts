/**
 * @jest-environment node
 *
 * LUM-1103 / LUM-1115 — `findMemberByEmail` resolves the Slack caller's
 * member with exactly one user-directory call, filtered by the email
 * (`getUserList({ emailAddress })`), whatever the workspace's member count —
 * never a scan of every member's profile, never one `getUser` per member.
 */

const mockListActiveMembersByClerkIds = jest.fn()
jest.mock('@/lib/repositories/slack-command.repository', () => ({
  slackCommandRepository: {
    listActiveMembersByClerkIds: (...a: unknown[]) =>
      mockListActiveMembersByClerkIds(...a),
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
interface ListQuery {
  userId?: string[]
  emailAddress?: string[]
  limit?: number
}
// Like both providers: an email filter matches any of a user's addresses,
// case-insensitively.
const mockGetUserList = jest.fn(async (q: ListQuery) => {
  const all = [...mockUsers.values()]
  const wanted = (q.emailAddress ?? []).map(e => e.toLowerCase())
  const data = all.filter(
    u =>
      (q.userId ?? []).includes(u.id) ||
      u.emailAddresses.some(e => wanted.includes(e.emailAddress.toLowerCase()))
  )
  return { data: data.slice(0, q.limit ?? 10) }
})
jest.mock('@/lib/auth/users', () => ({
  createUserDirectory: async () => ({
    getUser: (id: string) => mockGetUser(id),
    getUserList: (q: ListQuery) => mockGetUserList(q),
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
  primeMembers(members)
  return members
}

type MemberRow = { id: string; clerkId: string; actor: { id: string } | null }

/** The repository returns the active members among the ids it is given. */
function primeMembers(members: MemberRow[]) {
  mockListActiveMembersByClerkIds.mockImplementation(
    async (_ws: string, ids: string[]) =>
      members.filter(m => ids.includes(m.clerkId))
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUsers = new Map()
})

describe('slackCommandService.findMemberByEmail — directory call count', () => {
  it('makes one email-filtered directory call for 50 members, no id scan', async () => {
    seed(50)
    const found = await slackCommandService.findMemberByEmail(
      'ws_1',
      'person49@example.com'
    )
    expect(found?.memberId).toBe('wm_49')
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockGetUserList).toHaveBeenCalledTimes(1)
    const query = mockGetUserList.mock.calls[0]![0]
    expect(query.emailAddress).toEqual(['person49@example.com'])
    expect(query.userId).toBeUndefined()
  })

  it.each([5, 100, 250, 1000])(
    'makes exactly one directory call with %i members',
    async count => {
      seed(count)
      const found = await slackCommandService.findMemberByEmail(
        'ws_1',
        `person${count - 1}@example.com`
      )
      expect(found?.memberId).toBe(`wm_${count - 1}`)
      expect(mockGetUserList).toHaveBeenCalledTimes(1)
      expect(mockGetUser).not.toHaveBeenCalled()
    }
  )

  it('asks the repository only about the matched users, scoped to the workspace', async () => {
    seed(100)
    await slackCommandService.findMemberByEmail('ws_1', 'person7@example.com')
    expect(mockListActiveMembersByClerkIds).toHaveBeenCalledTimes(1)
    expect(mockListActiveMembersByClerkIds).toHaveBeenCalledWith('ws_1', [
      'user_7',
    ])
  })

  it('makes no member query when no directory user has that email', async () => {
    seed(10)
    expect(
      await slackCommandService.findMemberByEmail('ws_1', 'nobody@example.com')
    ).toBeNull()
    expect(mockGetUserList).toHaveBeenCalledTimes(1)
    expect(mockListActiveMembersByClerkIds).not.toHaveBeenCalled()
  })

  it('makes no directory call for a blank email', async () => {
    seed(10)
    expect(await slackCommandService.findMemberByEmail('ws_1', '  ')).toBeNull()
    expect(mockGetUserList).not.toHaveBeenCalled()
  })
})

describe('slackCommandService.findMemberByEmail — match semantics unchanged', () => {
  it('matches the primary email case-insensitively and trims input', async () => {
    primeMembers([{ id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } }])
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
    // One call carries the normalised and the as-given (trimmed) spelling,
    // so a case-sensitive provider filter still finds the user.
    expect(mockGetUserList).toHaveBeenCalledTimes(1)
    expect(mockGetUserList.mock.calls[0]![0].emailAddress).toEqual([
      'dev.person@example.com',
      'DEV.PERSON@example.COM',
    ])
  })

  it('finds the user when the provider filter is case-sensitive', async () => {
    primeMembers([{ id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } }])
    mockUsers = new Map([['user_1', user('user_1', 'Dev@Example.com')]])
    mockGetUserList.mockImplementationOnce(async (q: ListQuery) => ({
      data: [...mockUsers.values()].filter(u =>
        u.emailAddresses.some(e =>
          (q.emailAddress ?? []).includes(e.emailAddress)
        )
      ),
    }))
    const found = await slackCommandService.findMemberByEmail(
      'ws_1',
      'Dev@Example.com'
    )
    expect(found?.memberId).toBe('wm_1')
    expect(mockGetUserList).toHaveBeenCalledTimes(1)
  })

  it('ignores a matching non-primary email', async () => {
    primeMembers([{ id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } }])
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
    primeMembers([
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

  it('returns null when the matched user is not an active member here', async () => {
    primeMembers([{ id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } }])
    mockUsers = new Map([['user_x', user('user_x', 'dev@example.com')]])
    expect(
      await slackCommandService.findMemberByEmail('ws_1', 'dev@example.com')
    ).toBeNull()
  })
})
