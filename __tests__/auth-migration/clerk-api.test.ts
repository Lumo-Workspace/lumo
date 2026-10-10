/**
 * @jest-environment node
 *
 * LUM-1072 — Clerk Backend API export client: cursor paging, 429 / 5xx
 * backoff with Retry-After, give-up, and the key never leaking.
 */
import {
  clerkInstanceKind,
  fetchAllClerkUsers,
  fetchClerkUserCount,
  retryDelayMs,
} from '@/lib/auth-migration/clerk-api'
import {
  fakeClerkApi,
  loadClerkFixture,
} from '@/test-utils/auth-migration-fixtures'

const KEY = 'sk_test_fakefakefakefakefake'

describe('LUM-1072 Clerk API client', () => {
  const { apiUsers } = loadClerkFixture()

  it('pages with starting_after in ascending created_at until a short page', async () => {
    const api = fakeClerkApi(apiUsers)
    const pages: number[] = []
    const users = await fetchAllClerkUsers({
      secretKey: KEY,
      fetchImpl: api.fetchImpl,
      pageSize: 4,
      onPage: n => pages.push(n),
    })
    expect(users.map(u => u.id)).toEqual(apiUsers.map(u => u.id))
    expect(pages).toEqual([4, 8, 11])
    const urls = api.requests.map(r => new URL(r.url))
    expect(urls.map(u => u.searchParams.get('order_by'))).toEqual([
      '+created_at',
      '+created_at',
      '+created_at',
    ])
    expect(urls[0]!.searchParams.get('starting_after')).toBeNull()
    expect(urls[1]!.searchParams.get('starting_after')).toBe(apiUsers[3]!.id)
    expect(api.requests.every(r => r.authorization === `Bearer ${KEY}`)).toBe(
      true
    )
  })

  it('an exactly full last page costs one more (empty) request', async () => {
    const api = fakeClerkApi(apiUsers.slice(0, 8))
    const users = await fetchAllClerkUsers({
      secretKey: KEY,
      fetchImpl: api.fetchImpl,
      pageSize: 4,
    })
    expect(users).toHaveLength(8)
    expect(api.requests).toHaveLength(3)
  })

  it('retries 429 honouring Retry-After, then succeeds', async () => {
    const api = fakeClerkApi(apiUsers, { rateLimitOn: [1, 2], retryAfter: '3' })
    const sleeps: number[] = []
    const count = await fetchClerkUserCount({
      secretKey: KEY,
      fetchImpl: api.fetchImpl,
      sleep: async ms => {
        sleeps.push(ms)
      },
    })
    expect(count).toBe(11)
    expect(sleeps).toEqual([3000, 3000])
  })

  it('backs off exponentially without Retry-After and gives up after maxRetries; the error has no key', async () => {
    const api = fakeClerkApi(apiUsers, { rateLimitOn: [1, 2, 3, 4] })
    const sleeps: number[] = []
    const err = (await fetchAllClerkUsers({
      secretKey: KEY,
      fetchImpl: api.fetchImpl,
      maxRetries: 3,
      sleep: async ms => {
        sleeps.push(ms)
      },
    }).catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(
      /\/users still returned HTTP 429 after 3 retries/
    )
    expect(err.message).not.toContain(KEY)
    expect(sleeps).toEqual([1000, 2000, 4000])
  })

  it('non-retryable status fails at once with the status only', async () => {
    const err = (await fetchClerkUserCount({
      secretKey: KEY,
      fetchImpl: async () => ({
        status: 401,
        ok: false,
        headers: { get: () => null },
        json: async () => ({ secret: KEY }),
      }),
    }).catch((e: unknown) => e)) as Error
    expect(err.message).toBe('Clerk API /users/count returned HTTP 401.')
  })

  it('retryDelayMs caps waits; clerkInstanceKind recognises live/test keys only', () => {
    expect(retryDelayMs(10, null)).toBe(30_000)
    expect(retryDelayMs(0, '999')).toBe(60_000)
    expect(retryDelayMs(1, 'soon')).toBe(2000)
    expect(clerkInstanceKind('sk_live_x')).toBe('live')
    expect(clerkInstanceKind('sk_test_x')).toBe('test')
    expect(() => clerkInstanceKind('pk_test_x')).toThrow(/sk_live_ or sk_test_/)
  })
})
