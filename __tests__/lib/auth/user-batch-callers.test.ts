/**
 * @jest-environment node
 */
// LUM-1105 — regression: callers that used to send every id in one
// `getUserList` call (or pages of 500) lose users or fail against a
// directory that enforces Clerk's documented 100-id cap. Through the shared
// helper they get every user back, 100 ids per call.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AuthUser, UserListQuery } from '@/lib/auth/users'

const mockGetUserList = jest.fn()
jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn(async () => ({ getUserList: mockGetUserList })),
  createUserDirectory: jest.fn(async () => ({
    getUserList: mockGetUserList,
  })),
}))

import { enrichUsers, lookupUserProfiles } from '@/lib/auth/user-profiles'

function user(id: string): AuthUser {
  return {
    id,
    firstName: `F${id}`,
    lastName: null,
    username: null,
    imageUrl: '',
    primaryEmailAddressId: null,
    emailAddresses: [{ id: `e_${id}`, emailAddress: `${id}@x.io` }],
  }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `user_${i}`)

beforeEach(() => {
  mockGetUserList.mockReset()
  mockGetUserList.mockImplementation(async (query: UserListQuery) => {
    const userIds = query.userId ?? []
    if (userIds.length > 100) throw new Error('user_id accepts up to 100 ids')
    return { data: userIds.map(user).slice(0, query.limit ?? 10) }
  })
})

describe('callers page through the shared helper (100-id cap)', () => {
  it('enrichUsers returns all 250 users in 3 calls', async () => {
    const map = await enrichUsers(ids(250))

    expect(map.size).toBe(250)
    expect(mockGetUserList).toHaveBeenCalledTimes(3)
  })

  it('lookupUserProfiles returns all 250 profiles in 3 calls', async () => {
    const map = await lookupUserProfiles(ids(250))

    expect(map.size).toBe(250)
    expect(map.get('user_249')).toEqual({
      name: 'Fuser_249',
      email: 'user_249@x.io',
    })
    expect(mockGetUserList).toHaveBeenCalledTimes(3)
  })

  it('still makes a single call for 100 ids or fewer', async () => {
    await enrichUsers(ids(40))

    expect(mockGetUserList).toHaveBeenCalledTimes(1)
  })
})

/**
 * Every `getUserList(...)` call in app code whose argument filters by
 * `userId` must live in the shared helper; callers use `listUsersByIds`.
 * (Email-filtered calls are not id batches and are out of scope.)
 */
describe('source guard: userId lookups go through listUsersByIds', () => {
  const ALLOWED = new Set([
    'lib/auth/user-batch.ts',
    // The provider adapter implements the method itself.
    'lib/auth/better-auth/users.ts',
  ])

  function callArgument(source: string, openParen: number): string {
    let depth = 0
    for (let i = openParen; i < source.length; i += 1) {
      const ch = source[i]
      if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) return source.slice(openParen + 1, i)
      }
    }
    return source.slice(openParen + 1)
  }

  /** Repo-relative .ts/.tsx paths under `dir` (filesystem walk, no git). */
  function sourceFiles(root: string, dir: string): string[] {
    return readdirSync(path.join(root, dir), {
      recursive: true,
      encoding: 'utf8',
    })
      .filter(f => /\.tsx?$/.test(f))
      .map(f => path.posix.join(dir, f.split(path.sep).join('/')))
  }

  it('finds no direct userId-filtered getUserList call outside the helper', () => {
    const root = path.resolve(__dirname, '../../..')
    const files = ['lib', 'app', 'components'].flatMap(dir =>
      sourceFiles(root, dir)
    )
    expect(files).toContain('lib/auth/user-batch.ts')

    const offenders: string[] = []
    const needle = 'getUserList('
    for (const file of files) {
      if (ALLOWED.has(file)) continue
      const source = readFileSync(path.join(root, file), 'utf8')
      if (!source.includes(needle)) continue
      let at = source.indexOf(needle)
      while (at !== -1) {
        const arg = callArgument(source, at + needle.length - 1)
        if (/\buserId\b/.test(arg)) {
          const line = source.slice(0, at).split('\n').length
          offenders.push(`${file}:${line}`)
        }
        at = source.indexOf(needle, at + needle.length)
      }
    }
    expect(offenders).toEqual([])
  })
})
