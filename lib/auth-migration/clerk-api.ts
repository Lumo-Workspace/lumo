/**
 * LUM-1072 — read-only Clerk Backend API client for the export step
 * (RFC LUM-1069 §1.3). Only two GETs: `/v1/users/count` and `/v1/users`.
 *
 * - Paging uses the `starting_after` cursor with `order_by=+created_at`
 *   (GetUserList in https://github.com/clerk/openapi-specs/blob/main/bapi/2026-05-12.yml:
 *   cursor paging needs a created_at ordering; ascending means a user who
 *   signs up during the export lands on the last page instead of shifting
 *   earlier pages). 500 per page, stop on a short page.
 * - 429 (limit: 1000 requests / 10 s per production instance,
 *   https://clerk.com/docs/guides/how-clerk-works/system-limits) and 5xx are
 *   retried with backoff, honouring `Retry-After`.
 * - The secret key is only ever put in the Authorization header; errors
 *   name the HTTP status, never the key or the response body.
 * - `fetchImpl` and `sleep` are injected so tests replay recorded pages.
 */
import type { ClerkApiUser } from './clerk-export'

export const CLERK_API_BASE = 'https://api.clerk.com/v1'
export const CLERK_PAGE_SIZE = 500
export const CLERK_MAX_RETRIES = 6

export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string> }
) => Promise<{
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}>

export interface ClerkApiOptions {
  secretKey: string
  fetchImpl: FetchLike
  sleep?: ((ms: number) => Promise<void>) | undefined
  baseUrl?: string
  pageSize?: number
  maxRetries?: number
  /** Called with the running total after each page (counts only). */
  onPage?: (fetched: number) => void
}

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms))

function apiError(message: string, status = 502): Error {
  return Object.assign(new Error(message), { status })
}

/** `sk_live_…` → 'live', `sk_test_…` → 'test'; anything else is refused. */
export function clerkInstanceKind(secretKey: string): 'live' | 'test' {
  if (secretKey.startsWith('sk_live_')) return 'live'
  if (secretKey.startsWith('sk_test_')) return 'test'
  throw apiError(
    'The Clerk secret key must start with sk_live_ or sk_test_.',
    400
  )
}

/** Backoff for attempt n (0-based): Retry-After seconds, else 1s·2^n (max 30s). */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null
): number {
  const seconds = retryAfter !== null ? Number(retryAfter) : NaN
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000)
  }
  return Math.min(1000 * 2 ** attempt, 30_000)
}

async function getJson(path: string, opts: ClerkApiOptions): Promise<unknown> {
  const sleep = opts.sleep ?? defaultSleep
  const maxRetries = opts.maxRetries ?? CLERK_MAX_RETRIES
  const url = `${opts.baseUrl ?? CLERK_API_BASE}${path}`
  for (let attempt = 0; ; attempt++) {
    const res = await opts.fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${opts.secretKey}`,
        accept: 'application/json',
      },
    })
    if (res.ok) return res.json()
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= maxRetries) {
      const pathOnly = path.split('?')[0]
      throw apiError(
        retryable
          ? `Clerk API ${pathOnly} still returned HTTP ${res.status} after ${maxRetries} retries.`
          : `Clerk API ${pathOnly} returned HTTP ${res.status}.`
      )
    }
    await sleep(retryDelayMs(attempt, res.headers.get('retry-after')))
  }
}

export async function fetchClerkUserCount(
  opts: ClerkApiOptions
): Promise<number> {
  const body = (await getJson('/users/count', opts)) as {
    total_count?: unknown
  }
  if (typeof body?.total_count !== 'number') {
    throw apiError('Clerk API /users/count returned an unexpected shape.')
  }
  return body.total_count
}

export async function fetchAllClerkUsers(
  opts: ClerkApiOptions
): Promise<ClerkApiUser[]> {
  const limit = opts.pageSize ?? CLERK_PAGE_SIZE
  const users: ClerkApiUser[] = []
  let cursor: string | null = null
  for (;;) {
    const params = new URLSearchParams({
      limit: String(limit),
      order_by: '+created_at',
    })
    if (cursor) params.set('starting_after', cursor)
    const page = await getJson(`/users?${params.toString()}`, opts)
    if (!Array.isArray(page)) {
      throw apiError('Clerk API /users returned an unexpected shape.')
    }
    for (const u of page as ClerkApiUser[]) {
      if (typeof u?.id !== 'string') {
        throw apiError('Clerk API /users returned a user without an id.')
      }
      users.push(u)
    }
    opts.onPage?.(users.length)
    if (page.length < limit) return users
    cursor = (page[page.length - 1] as ClerkApiUser).id
  }
}
