/**
 * @jest-environment node
 */
// LUM-1105 — batch user lookups by id go through one helper that pages the
// ids in chunks of at most 100 (Clerk documents `userId` as "accepts up to
// 100 user IDs"), so no caller has to page on its own.
import type { AuthUser, UserListQuery } from '@/lib/auth/users'
import { listUsersByIds, USER_ID_BATCH_SIZE } from '@/lib/auth/user-batch'

function user(id: string): AuthUser {
  return {
    id,
    firstName: id,
    lastName: null,
    username: null,
    imageUrl: '',
    primaryEmailAddressId: null,
    emailAddresses: [],
  }
}

/**
 * A directory that honours the documented caps: more than 100 ids is
 * rejected, and `limit` (Clerk defaults to 10) bounds the page.
 */
function cappedDirectory(known: readonly string[]) {
  const store = new Set(known)
  const getUserList = jest.fn(async (query: UserListQuery) => {
    const ids = query.userId ?? []
    if (ids.length > 100) throw new Error('user_id accepts up to 100 ids')
    const data = ids.filter(id => store.has(id)).map(user)
    return { data: data.slice(0, query.limit ?? 10) }
  })
  return { getUserList }
}

const ids = (n: number, prefix = 'u') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe('listUsersByIds', () => {
  it('pages 250 ids into 3 calls of at most 100 and returns every user', async () => {
    const all = ids(250)
    const dir = cappedDirectory(all)

    const users = await listUsersByIds(dir, all)

    expect(USER_ID_BATCH_SIZE).toBe(100)
    expect(dir.getUserList).toHaveBeenCalledTimes(3)
    expect(dir.getUserList.mock.calls.map(([q]) => q.userId?.length)).toEqual([
      100, 100, 50,
    ])
    for (const [q] of dir.getUserList.mock.calls) {
      expect(q.limit).toBe(q.userId?.length)
    }
    expect(users.map(u => u.id).sort()).toEqual([...all].sort())
  })

  it('makes exactly one call for 100 ids or fewer', async () => {
    const all = ids(100)
    const dir = cappedDirectory(all)

    const users = await listUsersByIds(dir, all)

    expect(dir.getUserList).toHaveBeenCalledTimes(1)
    expect(dir.getUserList).toHaveBeenCalledWith({ userId: all, limit: 100 })
    expect(users).toHaveLength(100)
  })

  it('makes no call for an empty id list', async () => {
    const dir = cappedDirectory([])

    await expect(listUsersByIds(dir, [])).resolves.toEqual([])
    expect(dir.getUserList).not.toHaveBeenCalled()
  })

  it('de-duplicates ids before paging', async () => {
    const dir = cappedDirectory(['a', 'b'])

    const users = await listUsersByIds(dir, ['a', 'b', 'a', 'b', 'a'])

    expect(dir.getUserList).toHaveBeenCalledWith({
      userId: ['a', 'b'],
      limit: 2,
    })
    expect(users.map(u => u.id)).toEqual(['a', 'b'])
  })

  it('leaves out ids the directory no longer knows', async () => {
    const dir = cappedDirectory(['a'])

    const users = await listUsersByIds(dir, ['a', 'gone'])

    expect(users.map(u => u.id)).toEqual(['a'])
  })

  it('pages serially (one request in flight at a time)', async () => {
    let inFlight = 0
    let peak = 0
    const getUserList = jest.fn(async (query: UserListQuery) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight -= 1
      return { data: (query.userId ?? []).map(user) }
    })

    await listUsersByIds({ getUserList }, ids(301))

    expect(getUserList).toHaveBeenCalledTimes(4)
    expect(peak).toBe(1)
  })
})
