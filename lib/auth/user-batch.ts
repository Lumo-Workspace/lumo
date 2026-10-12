/**
 * LUM-1105 — batch user lookup by id, for either directory provider.
 *
 * Clerk documents `getUserList`'s `userId` filter as accepting up to 100 ids
 * (separate from `limit`, which caps a page at 500). Every caller that needs
 * profiles for a set of ids goes through `listUsersByIds`, which pages the
 * ids so callers never handle the cap themselves. Better Auth has no such
 * cap; paging is simply transparent there.
 *
 * Kept apart from `./users` (types only) so suites that mock
 * `@/lib/auth/users` still exercise the real paging.
 */
import type { AuthUser, UserDirectory } from './types'

/** Ids per `getUserList` call: Clerk's documented `userId` filter cap. */
export const USER_ID_BATCH_SIZE = 100

/**
 * Users for `ids`, one `getUserList` call per 100 distinct ids. Pages run
 * one at a time to stay clear of the provider's rate limit. Ids the
 * directory no longer knows are simply absent from the result.
 */
export async function listUsersByIds(
  directory: Pick<UserDirectory, 'getUserList'>,
  ids: readonly string[]
): Promise<AuthUser[]> {
  const unique = [...new Set(ids)]
  const users: AuthUser[] = []
  for (let i = 0; i < unique.length; i += USER_ID_BATCH_SIZE) {
    const page = unique.slice(i, i + USER_ID_BATCH_SIZE)
    // An id filter matches at most one user per id, so the page needs no
    // larger `limit` (Clerk's default of 10 would truncate it).
    const { data } = await directory.getUserList({
      userId: page,
      limit: page.length,
    })
    users.push(...data)
  }
  return users
}
